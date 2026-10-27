"""Running herdr-project-web as the watcher, in a pane of its own."""

import fcntl
import json
import os
import signal
import subprocess
from pathlib import Path


def state_dir(env):
    """Returns the directory that keeps what the watcher saw last, under
    $XDG_STATE_HOME from env, by default ~/.local/state."""
    state = env.get("XDG_STATE_HOME") or Path(env["HOME"]) / ".local/state"
    return Path(state) / "herdr-project"


def watcher_file(pane, env):
    """Returns the file that keeps the arguments of the watcher in Herdr
    pane pane, one per line, under state_dir(env). Herdr restores the
    pane as a shell, and zshrc resumes the watcher from it."""
    return state_dir(env) / "watcher" / pane


def remember_watcher(pane, args, env):
    """Records that the watcher runs in Herdr pane pane with args."""
    path = watcher_file(pane, env)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"{arg}\n" for arg in args))


def start(herdr, env):
    """Starts the watcher in a new workspace named watch unless one
    exists or a Herdr pane already has it, forgetting watcher panes that
    are gone, and returns whether it did. herdr runs a herdr command and
    returns its parsed output, or raises if it fails. The new
    workspace's shell sees HERDR_PROJECT_WATCH and runs the watcher."""
    folder = state_dir(env) / "watcher"
    folder.mkdir(parents=True, exist_ok=True)
    # Shells starting together must not open a workspace each.
    with open(state_dir(env) / "watcher.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        # A restore may bring back the workspace before its pane.
        workspaces = herdr("workspace", "list")["result"]["workspaces"]
        if any(w.get("label") == "watch" for w in workspaces):
            return False
        for path in folder.iterdir():
            try:
                herdr("pane", "get", path.name)
                return False
            except subprocess.CalledProcessError as e:
                # Other failures can't tell whether the pane is gone.
                if '"pane_not_found"' not in (e.stdout or "") + (e.stderr or ""):
                    raise
                path.unlink(missing_ok=True)
        created = herdr("workspace", "create", "--label", "watch", "--cwd", env["HOME"],
                        "--env", "HERDR_PROJECT_WATCH=1", "--no-focus")
        remember_watcher(created["result"]["root_pane"]["pane_id"], [], env)
        return True


def web_command(web, node_version=None):
    """Returns the command that runs herdr-project-web from directory
    web, or None if its packages aren't installed, node_version, by
    default node's, is older than 22.6, or it can't be restarted. Node
    restarts it whenever restart.stamp there is touched, which this
    creates if missing, without touching one that exists."""
    if not (web / "node_modules").is_dir():
        return None
    if node_version is None:
        try:
            node_version = subprocess.run(["node", "--version"], stdout=subprocess.PIPE,
                                          text=True, check=True, timeout=10).stdout
        except (OSError, subprocess.SubprocessError):
            return None
    try:
        if tuple(int(n) for n in node_version.strip().lstrip("v").split(".")[:2]) < (22, 6):
            return None
    except ValueError:
        return None
    stamp = web / "restart.stamp"
    try:
        open(stamp, "a").close()
    except OSError:
        return None
    return ["node", f"--watch-path={stamp}", "--experimental-strip-types",
            "--disable-warning=ExperimentalWarning", str(web / "main.ts")]


def web_env(env, orgs, tty):
    """Returns env for herdr-project-web as the watcher of the pull
    requests in orgs, or all without orgs, showing them on the terminal
    tty if not None."""
    out = {**env, "HERDR_PROJECT_ORGS": json.dumps(list(orgs))}
    if tty:
        out["HERDR_PROJECT_TTY"] = tty
    return out


def run_web(command, orgs, log, env):
    """Runs command, herdr-project-web, as web_env describes it, with
    env, writing its output to the file log and leaving this process's
    terminal, if any, to the pull requests, until it exits. SIGTERM or
    SIGHUP, even one that comes as it starts, ends it with SIGTERM, which
    node's watch mode passes on to the page, unlike SIGHUP; this then
    returns None, or else its exit code. Ctrl-C reaches it from the
    terminal, so on KeyboardInterrupt this waits for it to exit before
    raising. Raises OSError if it can't start."""
    tty = os.ttyname(1) if os.isatty(1) else None
    log.parent.mkdir(parents=True, exist_ok=True)
    child, stopped = None, []

    def forward(sig, _frame):
        stopped.append(sig)
        if child:
            child.terminate()

    saved = {sig: signal.signal(sig, forward) for sig in (signal.SIGTERM, signal.SIGHUP)}
    try:
        with open(log, "w") as out:
            child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=out, stderr=out,
                                     env=web_env(env, orgs, tty))
        if stopped:
            child.terminate()
        try:
            code = child.wait()
        except KeyboardInterrupt:
            child.wait()
            raise
    finally:
        for sig, handler in saved.items():
            signal.signal(sig, handler)
    return None if stopped else code


def main(orgs=(), pane=None):
    """Watches the pull requests in orgs, or all without orgs, of the
    projects under ~/project, and the rest herdr-project-web watches, by
    running it. pane is the Herdr pane it runs in, if any, where zshrc
    resumes it after Herdr restores the session, unless it was
    interrupted. Without herdr-project-web, or if it exits on its own, it
    says so until interrupted, so that its pane stays rather than another
    opening."""
    watcher = None
    if pane:
        try:
            remember_watcher(pane, orgs, os.environ)
            watcher = watcher_file(pane, os.environ)
        except OSError:
            pass
    web = Path(__file__).resolve().parent.parent / "herdr-project-web"
    command = web_command(web)
    log = state_dir(os.environ) / "web.log"
    try:
        if not command:
            print(f"herdr-project --watch needs herdr-project-web: run npm install in {web}, "
                  "with Node 22.6 or later.", flush=True)
        else:
            try:
                code = run_web(command, orgs, log, os.environ)
            except OSError as e:
                print(f"herdr-project --watch can't run herdr-project-web: {e}", flush=True)
            else:
                if code is None:
                    return 0
                print(f"herdr-project-web exited with {code}; see {log}.", flush=True)
        while True:
            signal.pause()
    except KeyboardInterrupt:
        # Another Ctrl-C mustn't keep the pane from being forgotten.
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        if watcher:
            watcher.unlink(missing_ok=True)
        return 0

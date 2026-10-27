"""Watching the user's pull requests, Herdr panes, Slack conversations
and Linear issues together, each at its own pace, in one pane."""

import fcntl
import json
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from herdr_project import headless, linear, panes, pull_request, slack


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


def check_queue(module, names, poll):
    """Returns the lines, the rows and the inbox items of the source
    in module, which a headless Claude session checks with its claude.ai
    connector, by calling poll if the connector is among names, the
    connected ones. Without the connector, there are no lines or rows,
    hiding the source, and no items. If names is None, as when listing
    the connectors failed, the lines say so, there are no rows, and the
    items are None, keeping the last ones."""
    if names is None:
        return ["Cannot list the claude.ai connectors."], None, None
    if module.CONNECTOR not in names:
        return None, None, []
    return poll()


def screen(sections):
    """Returns the text of the pane for sections, (title, time, lines,
    ...) tuples, where time is when the lines were made or None, leaving
    out those whose lines are None."""
    out = []
    for title, at, lines, *_ in sections:
        if lines is None:
            continue
        stamp = f" at {at:%H:%M}" if at else ""
        out += [f"{title}{stamp}", *lines, ""]
    return "\n".join(out).rstrip("\n")


def screen_state(sections, nexts=None):
    """Returns sections, (title, time, lines) tuples, as screen shows
    them, in the form reported to other viewers: a list of
    dicts with the title, the time in ISO 8601 or None, when the section
    is checked again, from nexts, those times by title, or None, and the
    lines. A section may have a fourth item, the pull requests it lists,
    as pull_request.listed returns them, kept as pullRequests unless
    None, and a fifth, the rows of a queue as its entries function
    returns them, kept as entries unless None."""
    out = []
    for title, at, lines, *rest in sections:
        if lines is None:
            continue
        upcoming = (nexts or {}).get(title)
        out.append({"title": title, "at": at.isoformat() if at else None,
                    "next": upcoming.isoformat() if upcoming else None, "lines": lines})
        if rest and rest[0] is not None:
            out[-1]["pullRequests"] = rest[0]
        if len(rest) > 1 and rest[1] is not None:
            out[-1]["entries"] = rest[1]
    return out


def title(items):
    """Returns the title for the watcher's workspace from items, the
    inbox items by source: how many wait on the user from each."""
    counts = [f"{source}: {len(found)}" for source, found in items.items()
              if isinstance(found, list) and found]
    return " · ".join(counts) or "Nothing waiting"


def reporter(env):
    """Returns the function that sends what the watcher shows to
    herdr-project-web, which runs it with the pipe in
    $HERDR_PROJECT_REPORT_FD from env, or None without one. It takes
    the sections, as screen_state returns them, and the inbox items by
    source, and writes them as one line of JSON, which waits while the
    page's pipe is full. The variable goes from env, so that this
    process's children don't take the pipe for theirs."""
    fd = env.pop("HERDR_PROJECT_REPORT_FD", None)
    if not fd:
        return None
    out = os.fdopen(int(fd), "w", buffering=1)
    lock = threading.Lock()

    def report(sections, items):
        line = json.dumps({"sections": sections, "inbox": items}) + "\n"
        with lock:
            out.write(line)

    return report


def watch(herdr, root, state, orgs=(), pr_interval=300, queue_interval=1800,
          connectors=headless.connectors, workspace=None, report=None):
    """Polls the pull requests in orgs, or all without orgs, and the
    Herdr panes every pr_interval seconds, and the Slack conversations
    and Linear issues every queue_interval seconds, those in the
    background since Claude takes a while, each only while its claude.ai
    connector is among those connectors returns. It prints them all
    until interrupted, passes them and what waits on the user to report,
    if any, as reporter's function takes them, and reports how much does
    as the title of Herdr workspace workspace, if any. Failures show
    instead of their lines, keeping their last inbox items."""
    lock = threading.Lock()
    prs = ["Pull requests", None, ["Checking…"], None]
    pane_section = ["Panes", None, ["Checking…"]]
    queues = [(slack, ["Slack", None, None], "slack.json"),
              (linear, ["Linear", None, None], "linear.json")]
    pr_owners = {}
    # The queues start together; one listing serves both.
    listing_lock, listing = threading.Lock(), []

    def connected():
        with listing_lock:
            if not listing or time.monotonic() - listing[0] > 60:
                listing[:] = [time.monotonic(), connectors()]
            return listing[1]

    items = {}

    def found(source, new):
        """Keeps the inbox items new of source. Call with lock held."""
        items[source] = new
        if workspace:
            try:
                herdr("workspace", "report-metadata", workspace, "--source", "watch",
                      "--token", f"title={title(items)}")
            except (OSError, subprocess.CalledProcessError):
                pass

    # When each section is checked again, by title, set as its loop
    # goes to sleep.
    nexts = {}

    def sleep(seconds, *titles):
        with lock:
            for t in titles:
                nexts[t] = datetime.now().astimezone() + timedelta(seconds=seconds)
        show()
        time.sleep(seconds)

    def show():
        with lock:
            sections = [tuple(prs), tuple(pane_section),
                        *(tuple(section) for _, section, _ in queues)]
            sys.stdout.write("\033[H\033[2J" + screen(sections))
            sys.stdout.flush()
            shown = screen_state(sections, nexts), dict(items)
        # Outside the lock, so that a page slow to read stalls only this.
        if report:
            try:
                report(*shown)
            except OSError:
                pass  # The pane still shows them.

    def queue_loop(module, section, name):
        while True:
            with lock:
                owners = dict(pr_owners)
            try:
                lines, rows, new = check_queue(
                    module, connected(), lambda owners=owners: module.poll(
                        herdr, pull_request.notes_texts(root), state / name, owners))
            except Exception as e:  # noqa: BLE001 - shown rather than ending the thread.
                lines, rows, new = [f"Cannot check {section[0]}: {e!r}"], None, None
            with lock:
                section[1:] = [datetime.now().astimezone(), lines, None, rows]
                if new is not None:
                    found(section[0], new)
            sleep(queue_interval, section[0])

    # The queues start after the first pull requests, whose projects they use.
    threads = [threading.Thread(target=queue_loop, args=q, daemon=True) for q in queues]
    while True:
        try:
            lines, owners, new, rows = pull_request.poll(
                herdr, root, state / "pull-requests.json", orgs=orgs)
        except Exception as e:  # noqa: BLE001 - shown rather than ending the watcher.
            lines, owners, new, rows = [f"Cannot check pull requests: {e!r}"], {}, None, None
        with lock:
            prs[1:] = [datetime.now().astimezone(), lines, rows]
            pr_owners.update(owners)
            if new is not None:
                found(prs[0], new)
        try:
            lines, new = panes.poll(herdr, root, state / "panes.json",
                                    datetime.now().astimezone())
        except Exception as e:  # noqa: BLE001 - shown rather than ending the watcher.
            lines, new = [f"Cannot check panes: {e!r}"], None
        with lock:
            pane_section[1:] = [datetime.now().astimezone(), lines]
            if new is not None:
                found(pane_section[0], new)
        for t in threads:
            if t.ident is None:
                t.start()
        # The panes are checked right after the pull requests.
        sleep(pr_interval, prs[0], pane_section[0])


def watch_workspace(herdr, pane, env):
    """Returns the id of the Herdr workspace named watch that pane, the
    watcher's pane if any, is in, from env, or None. Only that one takes
    the watcher's title."""
    workspace = env.get("HERDR_WORKSPACE_ID")
    if not pane or not workspace:
        return None
    try:
        label = herdr("workspace", "get", workspace)["result"]["workspace"].get("label")
    except (OSError, KeyError, TypeError, subprocess.CalledProcessError):
        return None
    return workspace if label == "watch" else None


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


def web_env(env, poller, tty):
    """Returns env for herdr-project-web, which runs poller, the command
    line that polls without serving, as its child, writing to the
    terminal tty if not None."""
    out = {**env, "HERDR_PROJECT_POLLER": json.dumps(poller)}
    if tty:
        out["HERDR_PROJECT_TTY"] = tty
    return out


def exec_web(command, poller, log, env):
    """Replaces this process with command, herdr-project-web, which runs
    poller as its child with env, writing its own output to the file
    log, and leaving this process's terminal, if any, to poller. Raises
    if it can't."""
    tty = os.ttyname(1) if os.isatty(1) else None
    log.parent.mkdir(parents=True, exist_ok=True)
    out = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    saved = os.dup(1), os.dup(2)
    os.dup2(out, 1)
    os.dup2(out, 2)
    try:
        os.execvpe(command[0], command, web_env(env, poller, tty))
    except OSError:
        os.dup2(saved[0], 1)
        os.dup2(saved[1], 2)
        raise
    finally:
        for fd in (out, *saved):
            os.close(fd)


def main(herdr, orgs=(), pane=None, poller=None):
    """Watches the pull requests in orgs, or all without orgs, Slack
    conversations and Linear issues of the projects under ~/project.
    pane is the Herdr pane it runs in, if any, where zshrc resumes it
    after Herdr restores the session, unless it was interrupted. Once its
    packages are installed, herdr-project-web takes this process's place
    and runs poller, the command line that calls poll, as its child."""
    if pane:
        try:
            remember_watcher(pane, orgs, os.environ)
        except OSError:
            pass
    command = web_command(Path(__file__).resolve().parent.parent / "herdr-project-web")
    if command and poller:
        try:
            exec_web(command, poller, state_dir(os.environ) / "web.log", os.environ)
        except OSError:
            pass
    return poll(herdr, orgs, pane)


def poll(herdr, orgs=(), pane=None):
    """Watches as main does, without serving the page. pane is the Herdr
    pane it runs in, if any, whose record main keeps; an interrupt
    forgets it."""
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, lambda *_: sys.exit(0))
    try:
        watch(herdr, Path.home() / "project", state_dir(os.environ), orgs,
              workspace=watch_workspace(herdr, pane, os.environ),
              report=reporter(os.environ))
    except KeyboardInterrupt:
        if pane:
            watcher_file(pane, os.environ).unlink(missing_ok=True)
    return 0

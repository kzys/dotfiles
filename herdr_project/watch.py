"""Watching the user's pull requests, Herdr panes, Slack conversations
and Linear issues together, each at its own pace, in one pane."""

import fcntl
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from herdr_project import headless, inbox, linear, panes, pull_request, slack
from herdr_project.state import save_state


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
    """Returns the lines and inbox items of the source in module, which
    a headless Claude session checks with its claude.ai connector, by
    calling poll if the connector is among names, the connected ones.
    Without the connector, there are no lines, hiding the source, and
    no items. If names is None, as when listing the connectors failed,
    the lines say so and the items are None, keeping the last ones."""
    if names is None:
        return ["Cannot list the claude.ai connectors."], None
    if module.CONNECTOR not in names:
        return None, []
    return poll()


def screen(sections):
    """Returns the text of the pane for sections, (title, time, lines)
    tuples, where time is when the lines were made or None, leaving out
    those whose lines are None."""
    out = []
    for title, at, lines in sections:
        if lines is None:
            continue
        stamp = f" at {at:%H:%M}" if at else ""
        out += [f"{title}{stamp}", *lines, ""]
    return "\n".join(out).rstrip("\n")


def screen_state(sections):
    """Returns sections, (title, time, lines) tuples, as screen shows
    them, in the form kept in screen.json for other viewers: a list of
    dicts with the title, the time in ISO 8601 or None, and the lines."""
    return [{"title": t, "at": at.isoformat() if at else None, "lines": lines}
            for t, at, lines in sections if lines is not None]


def title(items):
    """Returns the title for the watcher's workspace from items, the
    inbox items by source: how many wait on the user from each."""
    counts = [f"{source}: {len(found)}" for source, found in items.items()
              if isinstance(found, list) and found]
    return " · ".join(counts) or "Nothing waiting"


def watch(herdr, root, state, orgs=(), pr_interval=300, queue_interval=1800,
          connectors=headless.connectors, workspace=None):
    """Polls the pull requests in orgs, or all without orgs, and the
    Herdr panes every pr_interval seconds, and the Slack conversations
    and Linear issues every queue_interval seconds, those in the
    background since Claude takes a while, each only while its claude.ai
    connector is among those connectors returns. It prints them all
    until interrupted, keeps what waits on the user in inbox.json for
    the inbox, and reports how much does as the title of Herdr workspace
    workspace, if any. Failures show instead of their lines, keeping
    their last inbox items."""
    lock = threading.Lock()
    prs = ["Pull requests", None, ["Checking…"]]
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

    # Keep the last run's items until each source finds new ones.
    items = inbox.read_sources(state / "inbox.json")

    def found(source, new):
        """Keeps the inbox items new of source. Call with lock held."""
        items[source] = new
        try:
            inbox.write_sources(state / "inbox.json", items)
        except OSError:
            pass  # The pane still shows them, and the next poll retries.
        if workspace:
            try:
                herdr("workspace", "report-metadata", workspace, "--source", "watch",
                      "--token", f"title={title(items)}")
            except (OSError, subprocess.CalledProcessError):
                pass

    def show():
        with lock:
            sections = [tuple(prs), tuple(pane_section),
                        *(tuple(section) for _, section, _ in queues)]
            sys.stdout.write("\033[H\033[2J" + screen(sections))
            sys.stdout.flush()
            try:
                save_state(state / "screen.json", screen_state(sections))
            except OSError:
                pass  # The pane still shows them.

    def queue_loop(module, section, name):
        while True:
            with lock:
                owners = dict(pr_owners)
            try:
                lines, new = check_queue(module, connected(), lambda owners=owners: module.poll(
                    herdr, pull_request.notes_texts(root), state / name, owners))
            except Exception as e:  # noqa: BLE001 - shown rather than ending the thread.
                lines, new = [f"Cannot check {section[0]}: {e!r}"], None
            with lock:
                section[1:] = [datetime.now().astimezone(), lines]
                if new is not None:
                    found(section[0], new)
            show()
            time.sleep(queue_interval)

    # The queues start after the first pull requests, whose projects they use.
    threads = [threading.Thread(target=queue_loop, args=q, daemon=True) for q in queues]
    while True:
        try:
            lines, owners, new = pull_request.poll(
                herdr, root, state / "pull-requests.json", orgs=orgs)
        except Exception as e:  # noqa: BLE001 - shown rather than ending the watcher.
            lines, owners, new = [f"Cannot check pull requests: {e!r}"], {}, None
        with lock:
            prs[1:] = [datetime.now().astimezone(), lines]
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
        show()
        for t in threads:
            if t.ident is None:
                t.start()
        time.sleep(pr_interval)


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


def web_command(web):
    """Returns the command that runs herdr-project-web from directory
    web, or None if its packages aren't installed."""
    if not (web / "node_modules").is_dir():
        return None
    return ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning",
            str(web / "server.ts")]


def start_web(command, log):
    """Starts command, if any, writing its output to the file log, and
    returns its process, or None if it can't start. It stays in the
    watcher's process group, so that Ctrl-C reaches it too."""
    if not command:
        return None
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        with open(log, "w") as out:
            return subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=out,
                                    stderr=subprocess.STDOUT)
    except OSError:
        return None


def main(herdr, orgs=(), pane=None):
    """Watches the pull requests in orgs, or all without orgs, Slack
    conversations and Linear issues of the projects under ~/project,
    serving them with herdr-project-web while it runs. pane is the Herdr
    pane it runs in, if any, where zshrc resumes it after Herdr restores
    the session, unless it was interrupted."""
    if pane:
        try:
            remember_watcher(pane, orgs, os.environ)
        except OSError:
            pass
    web = start_web(web_command(Path(__file__).resolve().parent.parent / "herdr-project-web"),
                    state_dir(os.environ) / "web.log")
    # Stop the page too when the watcher is killed or its pane closes,
    # or it keeps the port from the next watcher's.
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, lambda *_: sys.exit(0))
    try:
        watch(herdr, Path.home() / "project", state_dir(os.environ), orgs,
              workspace=watch_workspace(herdr, pane, os.environ))
    except KeyboardInterrupt:
        if pane:
            watcher_file(pane, os.environ).unlink(missing_ok=True)
    finally:
        if web:
            web.terminate()
    return 0

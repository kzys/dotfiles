"""Watching the user's pull requests, Slack conversations and Linear
issues together, each at its own pace, in one pane."""

import fcntl
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from herdr_project import inbox, linear, pull_request, slack


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
                if '"pane_not_found"' not in (e.stdout or ""):
                    raise
                path.unlink(missing_ok=True)
        created = herdr("workspace", "create", "--label", "watch", "--cwd", env["HOME"],
                        "--env", "HERDR_PROJECT_WATCH=1", "--no-focus")
        remember_watcher(created["result"]["root_pane"]["pane_id"], [], env)
        return True


def screen(sections):
    """Returns the text of the pane for sections, (title, time, lines)
    tuples, where time is when the lines were made or None."""
    out = []
    for title, at, lines in sections:
        stamp = f" at {at:%H:%M}" if at else ""
        out += [f"{title}{stamp}", *lines, ""]
    return "\n".join(out).rstrip("\n")


def watch(herdr, root, state, orgs=(), pr_interval=300, queue_interval=1800):
    """Polls the pull requests in orgs, or all without orgs, every
    pr_interval seconds, and the Slack conversations and Linear issues
    every queue_interval seconds, those in the background since Claude
    takes a while, printing them all until interrupted and keeping what
    waits on the user in inbox.json for the inbox. Failures show instead
    of their lines, keeping their last inbox items."""
    lock = threading.Lock()
    prs = ["Pull requests", None, ["Checking…"]]
    queues = [(slack, ["Slack", None, ["Checking…"]], "slack.json"),
              (linear, ["Linear", None, ["Checking…"]], "linear.json")]
    pr_owners = {}
    # Keep the last run's items until each source finds new ones.
    items = inbox.read_sources(state / "inbox.json")

    def found(source, new):
        """Keeps the inbox items new of source. Call with lock held."""
        items[source] = new
        try:
            inbox.write_sources(state / "inbox.json", items)
        except OSError:
            pass  # The pane still shows them, and the next poll retries.

    def show():
        with lock:
            text = screen([tuple(prs), *(tuple(section) for _, section, _ in queues)])
            sys.stdout.write("\033[H\033[2J" + text)
            sys.stdout.flush()

    def queue_loop(module, section, name):
        while True:
            with lock:
                owners = dict(pr_owners)
            try:
                lines, new = module.poll(herdr, pull_request.notes_texts(root),
                                         state / name, owners)
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
        show()
        for t in threads:
            if t.ident is None:
                t.start()
        time.sleep(pr_interval)


def main(herdr, orgs=(), pane=None):
    """Watches the pull requests in orgs, or all without orgs, Slack
    conversations and Linear issues of the projects under ~/project.
    pane is the Herdr pane it runs in, if any, where zshrc resumes it
    after Herdr restores the session, unless it was interrupted."""
    if pane:
        try:
            remember_watcher(pane, orgs, os.environ)
        except OSError:
            pass
    try:
        watch(herdr, Path.home() / "project", state_dir(os.environ), orgs)
    except KeyboardInterrupt:
        if pane:
            watcher_file(pane, os.environ).unlink(missing_ok=True)
    return 0

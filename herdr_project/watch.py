"""Watching the user's pull requests, Slack conversations and Linear
issues together, each at its own pace, in one pane."""

import os
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


def main(herdr, orgs=()):
    """Watches the pull requests in orgs, or all without orgs, Slack
    conversations and Linear issues of the projects under ~/project."""
    try:
        watch(herdr, Path.home() / "project", state_dir(os.environ), orgs)
    except KeyboardInterrupt:
        pass
    return 0

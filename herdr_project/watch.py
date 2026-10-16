"""Watching the user's pull requests, Slack conversations and Linear
issues together, each at its own pace, in one pane."""

import os
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from herdr_project import linear, pull_request, slack



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
    takes a while, printing them all until interrupted. Failures show
    instead of their lines."""
    lock = threading.Lock()
    prs = ["Pull requests", None, ["Checking…"]]
    queues = [(slack, ["Slack", None, ["Checking…"]], "slack.json"),
              (linear, ["Linear", None, ["Checking…"]], "linear.json")]
    pr_owners = {}

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
                lines = module.poll(herdr, pull_request.notes_texts(root), state / name,
                                    owners)
            except Exception as e:  # Show any failure rather than end the thread.
                lines = [f"Cannot check {section[0]}: {e!r}"]
            with lock:
                section[1:] = [datetime.now(), lines]
            show()
            time.sleep(queue_interval)

    # The queues start after the first pull requests, whose projects they use.
    threads = [threading.Thread(target=queue_loop, args=q, daemon=True) for q in queues]
    while True:
        try:
            lines, owners = pull_request.poll(herdr, root, state / "pull-requests.json",
                                              orgs=orgs)
        except Exception as e:  # Show any failure rather than end the watcher.
            lines, owners = [f"Cannot check pull requests: {e!r}"], {}
        with lock:
            prs[1:] = [datetime.now(), lines]
            pr_owners.update(owners)
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

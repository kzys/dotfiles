"""Watching the user's pull requests and Slack conversations together,
each at its own pace, in one pane."""

import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

from herdr_project import pull_request, slack

ERRORS = (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError)


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


def watch(herdr, root, state, orgs=(), pr_interval=300, slack_interval=1800):
    """Polls the pull requests in orgs, or all without orgs, every
    pr_interval seconds and the Slack conversations every slack_interval
    seconds, in the background since Claude takes a while, printing both
    until interrupted. Failures show instead of their lines."""
    lock = threading.Lock()
    prs = ["Pull requests", None, ["Checking…"]]
    convs = ["Slack", None, ["Checking…"]]
    pr_owners = {}

    def show():
        with lock:
            text = screen([tuple(prs), tuple(convs)])
        sys.stdout.write("\033[H\033[2J" + text)
        sys.stdout.flush()

    def slack_loop():
        while True:
            with lock:
                owners = dict(pr_owners)
            try:
                lines = slack.poll(herdr, pull_request.notes_texts(root),
                                   state / "slack.json", owners)
            except ERRORS as e:
                lines = [f"Cannot check Slack: {e!r}"]
            with lock:
                convs[1:] = [datetime.now(), lines]
            show()
            time.sleep(slack_interval)

    # Slack starts after the first pull requests, whose projects it uses.
    slack_thread = threading.Thread(target=slack_loop, daemon=True)
    while True:
        try:
            lines, owners = pull_request.poll(herdr, root, state / "pull-requests.json",
                                              orgs=orgs)
        except ERRORS as e:
            lines, owners = [f"Cannot check pull requests: {e!r}"], {}
        with lock:
            prs[1:] = [datetime.now(), lines]
            pr_owners.update(owners)
        show()
        if slack_thread.ident is None:
            slack_thread.start()
        time.sleep(pr_interval)


def main(herdr, orgs=()):
    """Watches the pull requests in orgs, or all without orgs, and Slack
    conversations of the projects under ~/project."""
    try:
        watch(herdr, Path.home() / "project", state_dir(os.environ), orgs)
    except KeyboardInterrupt:
        pass
    return 0

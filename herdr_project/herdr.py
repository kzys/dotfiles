"""Running the herdr command."""

import json
import os
import subprocess


def herdr(*args, stderr=None, command=None):
    """Runs herdr with args and returns its parsed JSON output. Output
    that isn't JSON counts as {}. Raises if herdr fails. Its errors go
    to stderr, by default this process's. command is herdr's path, by
    default $HERDR_BIN_PATH or herdr."""
    command = command or os.environ.get("HERDR_BIN_PATH", "herdr")
    out = subprocess.run(
        [command, *args], stdout=subprocess.PIPE, stderr=stderr, text=True, check=True
    ).stdout
    try:
        return json.loads(out) if out.strip() else {}
    except ValueError:
        return {}


def in_pane(env, ancestors):
    """Reports whether a process runs in a Herdr pane, from its
    environment env and its ancestors' command lines.

    Background sessions run under the Claude Code daemon's
    --bg-pty-host. They inherit the HERDR_* variables of the pane that
    started the daemon but don't run in that pane."""
    if env.get("HERDR_ENV") != "1" or not env.get("HERDR_PANE_ID"):
        return False
    return not any("--bg-pty-host" in args for args in ancestors)


def ancestors(pid=None):
    """Yields the command line of process pid, by default this process's
    parent, and then those of its ancestors up to but not including
    init."""
    pid = os.getppid() if pid is None else pid
    while pid > 1:
        out = subprocess.run(
            ["ps", "-o", "ppid=,args=", "-p", str(pid)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=False,
        ).stdout.split(None, 1)
        if len(out) < 2 or not out[0].isdigit():
            return
        yield out[1].rstrip("\n")
        pid = int(out[0])

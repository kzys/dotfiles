"""The pane that follows the "## Remaining" section of an agent's notes."""

import json
import os
import select
import shutil
import socket
import subprocess
import sys
import textwrap
import time
from pathlib import Path


def remaining_section(role):
    """Returns the "## Remaining" section of AGENT-<role>.md, or a
    message saying why there is none."""
    if not role:
        return "Waiting for the agent to report its role."
    path = Path(f"AGENT-{role}.md")
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return f"No {path} yet."
    out = []
    in_section = False
    for line in lines:
        if line.startswith("## "):
            in_section = line == "## Remaining"
            if in_section:
                out.append(f"## Remaining: {role}")
                continue
        if in_section:
            out.append(line)
    return "\n".join(out) or f'No "## Remaining" section in {path} yet.'


class PaneWatch:
    """Learns from Herdr's socket when a pane closes or its process
    exits, without polling. Without the socket it can only sleep, and
    the caller polls."""

    def __init__(self, pane):
        self.pane = pane
        self.buf = b""
        try:
            self.sock = socket.socket(socket.AF_UNIX)
            self.sock.connect(os.environ["HERDR_SOCKET_PATH"])
            request = {"id": "1", "method": "events.subscribe",
                       "params": {"subscriptions": [{"type": "pane.closed"},
                                                 {"type": "pane.exited"}]}}
            self.sock.sendall(json.dumps(request).encode() + b"\n")
        except (OSError, KeyError):
            self.sock = None

    def closed(self, timeout):
        """Waits up to timeout seconds and returns whether the pane
        closed or its process exited meanwhile, or Herdr went away."""
        if self.sock is None:
            time.sleep(timeout)
            return False
        deadline = time.monotonic() + timeout
        try:
            while (left := deadline - time.monotonic()) > 0:
                if not select.select([self.sock], [], [], left)[0]:
                    break
                data = self.sock.recv(65536)
                if not data:  # Herdr is gone.
                    return True
                *lines, self.buf = (self.buf + data).split(b"\n")
                for line in lines:
                    try:
                        if json.loads(line).get("data", {}).get("pane_id") == self.pane:
                            return True
                    except (ValueError, AttributeError):
                        pass
        except OSError:
            self.sock = None
            time.sleep(max(0, deadline - time.monotonic()))
        return False


def follow_remaining(pane, herdr):
    """Prints the "## Remaining" section of the agent in Herdr pane
    until the pane is gone, refreshing every few seconds. herdr runs a
    herdr command and returns its parsed output, or raises if it fails,
    which means the pane is gone. A failed read of the role shows as a
    message rather than ending the loop, since that would close the
    pane."""
    watch = PaneWatch(pane)
    while True:
        try:
            info = herdr("pane", "get", pane)
        except (OSError, subprocess.CalledProcessError):
            return
        try:
            role = (info["result"]["pane"].get("tokens") or {}).get("role") or ""
            out = remaining_section(role)
        except (KeyError, TypeError, AttributeError) as e:
            out = f"Cannot read the agent's role: {e!r}"
        # Wrap to the pane's width and cut to its height, with no final
        # newline, so that the top stays in view.
        cols, rows = shutil.get_terminal_size((80, 24))
        wrapped = []
        for line in out.splitlines() or [""]:
            wrapped += textwrap.wrap(
                line, cols, drop_whitespace=False, replace_whitespace=False
            ) or [""]
        sys.stdout.write("\033[H\033[2J" + "\n".join(wrapped[:rows]))
        sys.stdout.flush()
        if watch.closed(5):
            return

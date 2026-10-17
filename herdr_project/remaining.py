"""The pane that follows the "## Remaining" section of an agent's notes."""

import json
import math
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


def fit(layout, pane, rows, shown):
    """Returns the herdr pane resize arguments that make the terminal in
    Herdr pane pane, now shown rows tall, rows tall, keeping the pane
    between a tenth of its tab, the least Herdr allows, and half of it:
    none if it is already, or None if the tab isn't split as
    herdr-project splits it, with pane above another. layout is the
    layout of herdr pane layout, whose heights include the pane's
    frame."""
    panes = layout["panes"]
    splits = layout["splits"]
    if (len(panes) != 2 or len(splits) != 1 or splits[0]["direction"] != "down"
            or panes[0]["pane_id"] != pane):
        return None
    height = layout["area"]["height"]
    frame = panes[0]["rect"]["height"] - shown
    wanted = max(math.ceil(height / 10), min(rows + frame, height // 2))
    if wanted == panes[0]["rect"]["height"]:
        return []
    amount = wanted / height - splits[0]["ratio"]
    return ["--pane", pane, "--direction", "down" if amount > 0 else "up",
            "--amount", f"{abs(amount):.4f}"]


def follower_file(pane, env):
    """Returns the file that names the agent pane Herdr pane pane
    follows, under $XDG_STATE_HOME from env, by default ~/.local/state.
    Herdr restores the pane as a shell, and zshrc resumes following
    from it."""
    state = env.get("XDG_STATE_HOME") or Path(env["HOME"]) / ".local/state"
    return Path(state) / "herdr-project/remaining" / pane


def remember_follower(pane, agent_pane, env):
    """Records that Herdr pane pane follows agent_pane."""
    path = follower_file(pane, env)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(agent_pane)


class PaneWatch:
    """Learns from Herdr's socket when a pane closes or its process
    exits, without polling. Without the socket it can only sleep, and
    the caller polls."""

    def __init__(self, pane, socket_path=None):
        """Watches pane through the socket at socket_path, by default
        $HERDR_SOCKET_PATH."""
        self.pane = pane
        self.buf = b""
        try:
            self.sock = socket.socket(socket.AF_UNIX)
            self.sock.connect(socket_path or os.environ["HERDR_SOCKET_PATH"])
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


def follow_remaining(pane, herdr, socket_path=None, own=None):
    """Prints the "## Remaining" section of the agent in Herdr pane
    until the pane is gone, refreshing every few seconds. herdr runs a
    herdr command and returns its parsed output, or raises if it fails,
    which means the pane is gone. A failed read of the role shows as a
    message rather than ending the loop, since that would close the
    pane. Herdr's socket is at socket_path, by default
    $HERDR_SOCKET_PATH. own is the Herdr pane this runs in, if any,
    which fits its section whenever the section's length changes."""
    watch = PaneWatch(pane, socket_path)
    fitted = None
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
        # Only on changes, so that resizing by hand lasts until then.
        if own and len(wrapped) != fitted:
            try:
                args = fit(herdr("pane", "layout", "--pane", own)["result"]["layout"],
                           own, len(wrapped), rows)
                # The pane may not be in place yet, so try again later.
                if args is not None:
                    if args:
                        herdr("pane", "resize", *args)
                    fitted = len(wrapped)
            except Exception:  # noqa: BLE001, S110 - fitting must not close the pane.
                pass
        sys.stdout.write("\033[H\033[2J" + "\n".join(wrapped[:rows]))
        sys.stdout.flush()
        if watch.closed(5):
            return

"""Running the herdr command."""

import json
import os
import subprocess


def herdr(*args, stderr=None):
    """Runs herdr, or $HERDR_BIN_PATH, with args and returns its parsed
    JSON output. Output that isn't JSON counts as {}. Raises if herdr
    fails. Its errors go to stderr, by default this process's."""
    command = os.environ.get("HERDR_BIN_PATH", "herdr")
    out = subprocess.run(
        [command, *args], stdout=subprocess.PIPE, stderr=stderr, text=True, check=True
    ).stdout
    try:
        return json.loads(out) if out.strip() else {}
    except ValueError:
        return {}


def herdr_or_none(*args):
    """Runs herdr like herdr, but quietly, and returns None if it fails."""
    try:
        return herdr(*args, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.CalledProcessError):
        return None

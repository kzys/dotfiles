"""Keeping what a poller saw last in a JSON file."""

import json
import os


def load_state(path):
    """Returns the state kept in path, or None if there is none or it
    can't be read."""
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def save_state(path, state):
    """Keeps state in path, replacing it whole so that readers, and a
    poll after a failed write, never see half of it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(state, indent=1))
    os.replace(tmp, path)

"""Running the Herdr app's commands and reading its panes from herdr-core."""

import json
import subprocess
from pathlib import Path

# herdr-core names some agents by their app, not their command.
AGENTS = {"claude-code": "claude"}
# Where Claude Code keeps a file for each running session.
CLAUDE_SESSIONS = Path.home() / ".claude" / "sessions"


def hc(*args, command="hc"):
    """Runs herdr-core's hc with args and returns its parsed JSON output.
    Raises if hc fails."""
    out = subprocess.run(
        [command, *args], stdout=subprocess.PIPE, text=True, check=True
    ).stdout
    return json.loads(out)


def herdr_app(name, args, command="herdr-app"):
    """Runs the Herdr app command name with the dict args and returns
    what it made. Raises if it fails."""
    out = subprocess.run(
        [command, "do", name, json.dumps(args)], stdout=subprocess.PIPE, text=True, check=True
    ).stdout
    return json.loads(out)


def claude_sessions(directory=CLAUDE_SESSIONS):
    """Returns the IDs of running Claude Code sessions by process ID,
    from the files Claude Code keeps in directory."""
    found = {}
    for path in directory.glob("*.json"):
        try:
            record = json.loads(path.read_text())
            found[record["pid"]] = record["sessionId"]
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return found


def pane_records(terminals, sessions):
    """Returns the panes among terminals, each a terminal from hc get
    with the agent hc ls reports, that show in a Herdr app space, as
    herdr-project-picker's pane_records does. sessions maps the process
    IDs of running Claude Code sessions to their IDs."""
    records = []
    for t in terminals:
        space = (t.get("labels") or {}).get("herdr.space")
        if t.get("state") != "live" or not space:
            continue
        foreground = t.get("foreground") or {}
        agent = AGENTS.get(t.get("agent"), t.get("agent"))
        records.append({
            "agent": agent,
            "workspace": space,
            "cwd": foreground.get("cwd") or t["cwd"],
            "pane": t["address"],
            "session": sessions.get(foreground.get("pid"), "") if agent == "claude" else "",
            "role": "",
        })
    return records


def panes(hc=hc, sessions=None):
    """Returns the panes of the Herdr app's spaces on this machine, as
    pane_records does, with sessions from claude_sessions() unless
    given. hc runs an hc command. A terminal that ends while this reads
    it is left out."""
    terminals = []
    for t in hc("ls", "--json")["terminals"]:
        try:
            terminals.append({**hc("get", t["address"], "--json"), "agent": t.get("agent")})
        except subprocess.CalledProcessError:
            continue
    return pane_records(terminals, claude_sessions() if sessions is None else sessions)

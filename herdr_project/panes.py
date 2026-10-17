"""Watching Herdr panes for agents whose context is nearly full and
shell panes that have long been idle."""

import hashlib
import os
import subprocess
from datetime import datetime, timedelta

from herdr_project import inbox
from herdr_project.herdr import pane_cwd
from herdr_project.inbox import Owner
from herdr_project.instructions import project_dir
from herdr_project.notes import project_name
from herdr_project.state import load_state, save_state

# How full an agent's context is when it should hand over to a new
# session, in percent.
FULL_AT = 80

# How long a shell pane's text may stay the same before it counts as
# idle.
IDLE_AFTER = timedelta(days=1)


def ctx(pane):
    """Returns how full the context of the agent in pane is, in percent,
    from the ctx token its status line reports, or None. A background
    session reports to the pane that started it, flagging that with the
    bg token, so then the ctx isn't the pane's own."""
    tokens = pane.get("tokens") or {}
    text = tokens.get("ctx")
    if tokens.get("bg") or not isinstance(text, str):
        return None
    try:
        return int(text.rstrip("%"))
    except ValueError:
        return None


def shells(panes):
    """Returns the panes among panes, in herdr pane list's form, that run
    no agent and share no tab with one, such as a pane following an
    agent's notes."""
    agent_tabs = {p.get("tab_id") for p in panes if p.get("agent")}
    return [p for p in panes if not p.get("agent") and p.get("tab_id") not in agent_tabs]


def read_pane(pane_id, command=None):
    """Returns the recent text of Herdr pane pane_id. command is herdr's
    path, by default $HERDR_BIN_PATH or herdr. Raises if herdr fails."""
    command = command or os.environ.get("HERDR_BIN_PATH", "herdr")
    return subprocess.run(
        [command, "pane", "read", pane_id, "--source", "recent", "--lines", "50"],
        capture_output=True, text=True, check=True).stdout


def remember(old, panes, texts, now):
    """Returns the state to keep for panes, from old, the state it
    returned last time, and texts, the text of each shell pane by id: a
    digest of each shell pane's text and since when it has had it, and
    the agents already told their context is full, as long as it stays
    full or unknown."""
    seen = old.get("panes")
    seen = seen if isinstance(seen, dict) else {}
    kept = {}
    for pane_id, text in texts.items():
        digest = hashlib.sha256(text.encode()).hexdigest()
        before = seen.get(pane_id)
        if isinstance(before, dict) and before.get("digest") == digest:
            kept[pane_id] = before
        else:
            kept[pane_id] = {"digest": digest, "since": now.isoformat()}
    told = old.get("told")
    told = set(told) if isinstance(told, list) else set()
    told = [p["pane_id"] for p in panes
            if p["pane_id"] in told and (ctx(p) is None or ctx(p) >= FULL_AT)]
    return {"panes": kept, "told": told}


def idle(state, panes, now):
    """Returns the shell panes among panes whose text hasn't changed for
    IDLE_AFTER, by state, with how long, as (pane, timedelta) tuples,
    the longest idle first."""
    out = []
    for p in shells(panes):
        try:
            since = datetime.fromisoformat(state["panes"][p["pane_id"]]["since"])
        except (KeyError, TypeError, ValueError):
            continue
        if now - since >= IDLE_AFTER:
            out.append((p, now - since))
    return sorted(out, key=lambda t: t[1], reverse=True)


def full(panes):
    """Returns the agent panes among panes whose context is at least
    FULL_AT percent full, the fullest first."""
    return sorted((p for p in panes if p.get("agent") and (ctx(p) or 0) >= FULL_AT),
                  key=ctx, reverse=True)


def owner(pane, root):
    """Returns the Owner of pane, with its project under root and the
    role of its agent, or None if it isn't in a project."""
    project = project_dir(pane_cwd(pane), root)
    if project is None:
        return None
    return Owner(str(project), role=(pane.get("tokens") or {}).get("role"))


def wake_message(pane):
    """Returns what to tell the agent in pane about its full context."""
    return (f"Your context is {ctx(pane)}% full. Update your notes so that a "
            f"new session can pick up from them, then tell the user.")


def days(span):
    """Returns span in whole days or hours, like 3d or 20h."""
    hours = int(span.total_seconds() // 3600)
    return f"{hours // 24}d" if hours >= 24 else f"{hours}h"


def poll(herdr, root, path, now, read=read_pane):
    """Checks the panes once: tells each agent whose context became full
    since the state in path to update its notes, if it is idle or done,
    keeps the new state there, and returns lines listing full agents and
    idle shell panes, and inbox items for those in projects. Only agents
    in projects are told. herdr runs a herdr command and returns its
    parsed output, and read returns a pane's text by its id. Projects
    are under root."""
    old = load_state(path)
    if not isinstance(old, dict):
        old = {}
    panes = herdr("pane", "list")["result"]["panes"]
    texts = {}
    for p in shells(panes):
        try:
            texts[p["pane_id"]] = read(p["pane_id"])
        except (OSError, subprocess.CalledProcessError):
            pass  # Unknown, so it starts over as not idle.
    state = remember(old, panes, texts, now)
    save_state(path, state)
    lines, items = [], []
    for p in full(panes):
        found = owner(p, root)
        where = project_name(found.project) if found else pane_cwd(p)
        lines.append(f"{ctx(p):>3}% {p['pane_id']:<8} {where}")
        # Only agents in projects keep notes to restart from.
        if not found:
            continue
        items.append(inbox.item(found, "ctx", f"{where}: context {ctx(p)}% full, "
                                f"restart it from its notes"))
        if p["pane_id"] in state["told"] or p.get("agent_status") not in ("idle", "done"):
            continue
        # Keep it told before telling, so a failed save can't tell it again.
        state["told"].append(p["pane_id"])
        save_state(path, state)
        try:
            herdr("pane", "run", p["pane_id"], wake_message(p))
        except (OSError, subprocess.CalledProcessError):
            state["told"].remove(p["pane_id"])
            save_state(path, state)
    for p, span in idle(state, panes, now):
        found = owner(p, root)
        where = project_name(found.project) if found else pane_cwd(p)
        lines.append(f"{days(span):>4} {p['pane_id']:<8} {where}")
        if found:
            items.append(inbox.item(found, "idle", f"shell pane {p['pane_id']} "
                                    f"idle for {days(span)}"))
    return lines or ["Nothing to clean up."], items

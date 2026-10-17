"""What waits on the user across projects: items in the agents' notes
tagged [you], and what the watcher found waiting on them."""

import json
import os
import re
from pathlib import Path

from herdr_project.notes import front_matter

# Untagged items that likely wait on the user, in notes written before
# agents were told to tag them.
LIKELY = re.compile(
    r"\b(decide|not (?:yet )?decided|needs? (?:a )?decision|decision (?:needed|pending)"
    r"|approve|approval|ask(?: the)? user|needs? (?:the )?user|open for (?:the )?user"
    r"|(?:agree|discuss|confirm|check)\w*\b.{0,40}?\bwith (?:the )?user"
    r"|user (?:to|ok(?:ay)?|decides?|says|wants|asks)|when (?:the )?user"
    r"|reviewed, not pushed|local only|not pushed per user)\b|\((?:ask|user)\)",
    re.IGNORECASE)

# Untagged items that the user may want to act on but nothing waits
# for, such as offers to follow up.
SOFT = re.compile(
    r"^(?:optional(?:ly)?|offers?)\b|\b(?:if|unless) (?:the )?user (?:wants|asks)",
    re.IGNORECASE)

# Untagged items starting with these say nothing waits.
SETTLED = ("none", "nothing", "done", "[x]")

# The order of marks in the inbox, most pressing first.
ORDER = {"you": 0, "?": 1, "maybe": 2, "close": 3}


def remaining_items(text):
    """Returns the items of the "## Remaining" section of notes text:
    each line starting with "- ", with the indented lines after it."""
    items = []
    in_section = False
    for line in text.splitlines():
        if line.startswith("## "):
            in_section = line == "## Remaining"
            continue
        if not in_section:
            continue
        if line.startswith("- "):
            items.append(line[2:].strip())
        elif items and line.startswith((" ", "\t")) and line.strip():
            items[-1] += " " + line.strip()
    return items


def waiting(item):
    """Returns how item waits on the user: "you" if it is tagged [you],
    "maybe" if it is untagged and only offers something, "?" if it is
    untagged and likely does, or None."""
    if item.lower().startswith("[you]"):
        return "you"
    item = item.removeprefix("[ ]").strip()  # An unticked task list item.
    if item.startswith("[") or item.lower().startswith(SETTLED):
        return None
    if SOFT.search(item):
        return "maybe"
    return "?" if LIKELY.search(item) else None


def role_notes(directory):
    """Returns the agents' notes in the project in directory as (role,
    text) tuples."""
    found = []
    for f in sorted(Path(directory).glob("AGENT-*.md")):
        try:
            found.append((f.stem[len("AGENT-"):], f.read_text(errors="replace")))
        except OSError:
            pass
    return found


def role_closed(text):
    """Reports whether the agent's notes text close its role, with a
    line starting with "closed:" and a link or a few words, before the
    first section."""
    for line in text.splitlines():
        if line.startswith("## "):
            return False
        if line.startswith("closed:") and line[len("closed:"):].strip():
            return True
    return False


def settled(text):
    """Reports whether the agent's notes text look finished: their
    "## Remaining" section has items, all saying nothing is left or
    ticked. An empty section may only not be written yet."""
    if "## Remaining" not in text.splitlines():
        return False
    items = remaining_items(text)
    return bool(items) and all(i.lower().startswith(SETTLED) for i in items)


def note_items(directory, notes=None):
    """Returns what waits on the user in the notes of the project in
    directory, or in notes as role_notes returns them, skipping closed
    roles, as dicts with its role, mark (as waiting returns it) and
    text, the most pressing first."""
    items = []
    for role, text in role_notes(directory) if notes is None else notes:
        if role_closed(text):
            continue
        for item in remaining_items(text):
            mark = waiting(item)
            if mark:
                items.append({"role": role, "mark": mark,
                              "text": item[len("[you]"):].strip() if mark == "you" else item})
    return sorted(items, key=rank)


def rank(item):
    """Returns where item goes in the inbox, the most pressing first;
    what the watcher found goes with the likely ones."""
    return ORDER.get(item["mark"], ORDER["?"])


def project_items(directory, watched=()):
    """Returns what waits on the user in the project in directory, as
    note_items does, followed by watched, the watcher's items for it. If
    the watcher found nothing, it also suggests closing the project when
    every open role looks finished, or else each role that does. A
    closed project has none."""
    if front_matter(directory, "closed"):
        return []
    notes = role_notes(directory)
    items = note_items(directory, notes) + list(watched)
    if watched:
        return items
    roles = [(r, t) for r, t in notes if not role_closed(t)]
    if notes and all(settled(t) for _, t in roles):
        return [{"role": None, "mark": "close",
                 "text": "Nothing remaining; tell its agent the task is done to close it"}]
    return items + [{"role": r, "mark": "close",
                     "text": f"Nothing remaining for {r}; tell its agent its part is done "
                             "to close it"}
                    for r, t in roles if settled(t)]


def read_sources(path):
    """Returns the inbox items the watcher kept in path by source, or {}
    if it hasn't run."""
    try:
        sources = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return sources if isinstance(sources, dict) else {}


def write_sources(path, sources):
    """Keeps the inbox items in sources, by source, in path, replacing
    it whole so that readers never see half of it."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(sources, indent=1))
    os.replace(tmp, path)


def watched_items(path):
    """Returns what the watcher found waiting on the user, from path, as
    dicts with the project, or None, role, or None, mark and text,
    skipping any not in that form."""
    return [i for items in read_sources(path).values() if isinstance(items, list)
            for i in items
            if isinstance(i, dict) and isinstance(i.get("text"), str)
            and isinstance(i.get("mark"), str)
            and isinstance(i.get("project"), (str, type(None)))
            and isinstance(i.get("role"), (str, type(None)))]


def item(found, mark, text):
    """Returns an inbox item for text with mark, belonging to the
    project that found, in pull_request.owner's form or None, describes."""
    return {"project": found["project"] if found else None,
            "role": found["role"] if found else None, "mark": mark, "text": text}

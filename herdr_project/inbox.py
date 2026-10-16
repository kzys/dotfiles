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


def note_items(directory):
    """Returns what waits on the user in the notes of the project in
    directory, as dicts with its role, mark (as waiting returns it) and
    text, the most pressing first."""
    items = []
    for f in sorted(Path(directory).glob("AGENT-*.md")):
        try:
            text = f.read_text(errors="replace")
        except OSError:
            continue
        for item in remaining_items(text):
            mark = waiting(item)
            if mark:
                items.append({"role": f.stem[len("AGENT-"):], "mark": mark,
                              "text": item[len("[you]"):].strip() if mark == "you" else item})
    return sorted(items, key=rank)


def rank(item):
    """Returns where item goes in the inbox, the most pressing first;
    what the watcher found goes with the likely ones."""
    return ORDER.get(item["mark"], ORDER["?"])


def settled(directory):
    """Reports whether the project in directory looks finished: it has
    agents' notes, each has a "## Remaining" section whose items all say
    nothing is left or are ticked, and at least one has such an item,
    since an empty section may only not be written yet."""
    found = False
    for f in Path(directory).glob("AGENT-*.md"):
        try:
            text = f.read_text(errors="replace")
        except OSError:
            continue
        if "## Remaining" not in text.splitlines():
            return False
        items = remaining_items(text)
        if not all(i.lower().startswith(SETTLED) for i in items):
            return False
        found = found or bool(items)
    return found


def project_items(directory, watched=()):
    """Returns what waits on the user in the project in directory, as
    note_items does, followed by watched, the watcher's items for it, or
    an item suggesting to close it if it looks finished and the watcher
    found nothing. A closed project has none."""
    if front_matter(directory, "closed"):
        return []
    if watched:
        return note_items(directory) + list(watched)
    if settled(directory):
        return [{"role": None, "mark": "close",
                 "text": "Nothing remaining; tell its agent the task is done to close it"}]
    return note_items(directory)


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

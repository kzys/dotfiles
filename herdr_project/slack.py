"""Finding the user's active Slack conversations, by asking a headless
Claude session that has the Slack connector, and telling the user when
one starts waiting on them."""

import re
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path

from herdr_project import headless, inbox, pull_request
from herdr_project.notes import project_name
from herdr_project.state import load_state, save_state

# The claude.ai connector the headless session needs.
CONNECTOR = "Slack"

SCHEMA = {
    "type": "object",
    "required": ["conversations"],
    "properties": {"conversations": {"type": "array", "items": {
        "type": "object",
        "required": ["channel_id", "thread_ts", "channel", "summary",
                     "waiting_on_me", "done", "last_ts"],
        "properties": {
            "channel_id": {"type": "string"},
            "thread_ts": {"type": "string"},
            "channel": {"type": "string"},
            "permalink": {"type": "string"},
            "summary": {"type": "string"},
            "waiting_on_me": {"type": "boolean"},
            "done": {"type": "boolean"},
            "last_ts": {"type": "string"},
            "links": {"type": "array", "items": {"type": "string"}},
        },
    }}},
}

TOOLS = [
    "mcp__claude_ai_Slack__slack_search_public_and_private",
    "mcp__claude_ai_Slack__slack_search_public",
    "mcp__claude_ai_Slack__slack_read_thread",
    "mcp__claude_ai_Slack__slack_read_channel",
]


def prompt(since):
    """Returns what to ask Claude for the conversations since the date
    since."""
    return (
        "List my active Slack conversations. I am the logged-in user; the "
        "search tool tells you my user ID. Search messages from me and "
        f"messages mentioning me since {since:%Y-%m-%d}, all channel types, "
        "sorted by timestamp, response_format detailed. Group the results by "
        "conversation: a thread (channel_id and thread_ts) or, for DM "
        'messages outside threads, the DM (thread_ts ""). Read each thread, '
        "at most 15, to see its latest message. last_ts is the ts of that "
        "message. waiting_on_me is true when someone else wrote after my "
        "last message and it asks or tells me something, or mentions me. "
        "done is true when nothing is left for me in it: what I was asked "
        "for has already happened, as when the pull requests it is about are "
        "merged or closed, or the question was answered or dropped. "
        "summary is one line saying what is pending. permalink is the "
        "conversation's Slack permalink: the thread's, or for a DM, that of "
        "its latest message. links are the GitHub pull request URLs in the "
        "conversation. Do not send anything."
    )


def fetch(state_dir, days=3, command="claude"):
    """Returns the user's Slack conversations of the last days days as
    the headless Claude session in state_dir reports them. Raises if it
    fails."""
    since = datetime.now().astimezone() - timedelta(days=days)
    return headless.ask(state_dir, prompt(since), SCHEMA, TOOLS, "conversations", command)


def key(conversation):
    """Returns what identifies conversation across runs."""
    return f"{conversation['channel_id']}/{conversation['thread_ts']}"


def owner(conversation, texts, pr_owners):
    """Returns the project working on conversation, as
    pull_request.project_of finds it from texts and pr_owners: the one
    whose notes mention the thread or, for a DM, the channel, else that
    of a pull request it links to."""
    ts = re.escape(conversation["thread_ts"].replace(".", ""))
    if ts:
        pattern = rf"(?<!\d)p?{ts}(?!\d)"
    else:
        pattern = rf"\b{re.escape(conversation['channel_id'])}\b"
    return pull_request.project_of(pattern, conversation.get("links"), texts, pr_owners)


def waiting(conversation):
    """Returns whether conversation waits on the user: Claude says so and
    doesn't find it done."""
    return conversation["waiting_on_me"] and not conversation.get("done")


def last(conversation):
    """Returns the ts of conversation's latest message, written the same
    way however Claude wrote it, if it is a number."""
    try:
        return f"{float(conversation['last_ts']):.6f}"
    except ValueError:
        return conversation["last_ts"]


def events(old, conversations):
    """Returns the conversations that started waiting on the user, or
    got a new message while waiting, since old, the state remember
    returned last time. With no old state there are none."""
    if old is None:
        return []
    return [c for c in conversations
            if waiting(c) and old.get(key(c)) != last(c)]


def remember(old, conversations, now, days=7):
    """Returns the state to compare the next conversations with: old
    updated with conversations, without those that have been quiet for
    days days before now, a Unix time."""
    state = dict(old or {})
    for c in conversations:
        state[key(c)] = last(c)

    def recent(ts):
        try:
            return float(ts) > now - days * 86400
        except ValueError:
            return True  # Keep what Claude wrote oddly, or it notifies every time.

    return {k: ts for k, ts in state.items() if recent(ts)}


def table(conversations, owners):
    """Returns lines listing conversations, those waiting on the user
    first and those done, marked with a check, last, within each group:
    those of a project with its name, from owners (by key), then
    the others under a line naming their channel, channels with a
    conversation waiting on the user first. Columns are as wide as
    their longest entry, so empty ones take no space."""
    def mark(c):
        return "*" if waiting(c) else "✓" if c.get("done") else " "

    ordered = sorted(conversations, key=lambda c: (not waiting(c), bool(c.get("done"))))
    ours = [c for c in ordered if owners.get(key(c))]
    names = {key(c): project_name(owners[key(c)].project) for c in ours}
    channel_width = max((len(c["channel"][:26]) for c in ours), default=0)
    name_width = max(map(len, names.values()), default=0)
    lines = [f"{mark(c)} {c['channel'][:26]:<{channel_width}} "
             f"{names[key(c)]:<{name_width}} {c['summary']}" for c in ours]
    # Group by ID, which Claude can't spell two ways, under the first name.
    channels = {}
    for c in ordered:
        if not owners.get(key(c)):
            channels.setdefault(c["channel_id"], []).append(c)
    for found in channels.values():
        lines.append(found[0]["channel"] or found[0]["channel_id"])
        lines += [f"  {mark(c)} {c['summary']}" for c in found]
    return lines


def entries(conversations, owners):
    """Returns conversations as rows for other viewers, with the name of
    their project from owners (by key): those waiting on the user first
    and those done last, then those of a project. Unlike table, it
    doesn't group them by project and channel."""
    rows = [{"label": c["channel"] or c["channel_id"], "title": c["summary"],
             "url": c.get("permalink") or None, "waiting": waiting(c),
             "done": bool(c.get("done")),
             "project": project_name(owners[key(c)].project) if owners.get(key(c)) else None}
            for c in conversations]
    return sorted(rows, key=lambda r: (not r["waiting"], r["done"], r["project"] is None))


def poll(herdr, texts, path, pr_owners, fetch=fetch):
    """Checks the Slack conversations once with fetch: tells the user
    about those newly waiting on them since the state in path, saves the
    new state there, and returns the lines of table, the rows of entries
    and inbox items for the conversations waiting on the user. herdr runs a herdr
    command. texts are the projects' notes, and pr_owners the projects
    of pull requests by url."""
    old = load_state(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    found = fetch(path.parent)
    owners = {key(c): owner(c, texts, pr_owners) for c in found}
    for c in events(old, found):
        project = owners.get(key(c))
        where = f" ({Path(project.project).name})" if project else ""
        try:
            herdr("notification", "show", f"Slack {c['channel']}",
                  "--body", f"{c['summary']}{where}", "--sound", "request")
        except (OSError, subprocess.CalledProcessError):
            pass
    save_state(path, remember(old, found, time.time()))
    items = [inbox.item(owners.get(key(c)), "slack", f"Slack {c['channel']}: {c['summary']}")
             for c in found if waiting(c)]
    return table(found, owners), entries(found, owners), items

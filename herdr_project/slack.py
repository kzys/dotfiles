"""Finding the user's active Slack conversations, by asking a headless
Claude session that has the Slack connector, and telling the user when
one starts waiting on them."""

import json
import re
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

from herdr_project.notes import front_matter

SCHEMA = {
    "type": "object",
    "required": ["conversations"],
    "properties": {"conversations": {"type": "array", "items": {
        "type": "object",
        "required": ["channel_id", "thread_ts", "channel", "summary",
                     "waiting_on_me", "last_ts"],
        "properties": {
            "channel_id": {"type": "string"},
            "thread_ts": {"type": "string"},
            "channel": {"type": "string"},
            "permalink": {"type": "string"},
            "summary": {"type": "string"},
            "waiting_on_me": {"type": "boolean"},
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
        "summary is one line saying what is pending. links are the GitHub "
        "pull request URLs in the conversation. Do not send anything."
    )


def fetch(state_dir, days=3, command="claude"):
    """Returns the user's Slack conversations of the last days days as
    the headless Claude session in state_dir reports them. Raises if it
    fails."""
    since = datetime.now() - timedelta(days=days)
    out = subprocess.run(
        [command, "-p", "--no-session-persistence", "--model", "sonnet",
         "--output-format", "json", "--max-budget-usd", "2",
         "--json-schema", json.dumps(SCHEMA), "--allowedTools", *TOOLS,
         "--", prompt(since)],
        cwd=state_dir, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, check=True, timeout=900,
    ).stdout
    return conversations(json.loads(out))


def conversations(result):
    """Returns the conversations in result, the JSON output of claude
    -p. Raises ValueError if Claude didn't produce them."""
    found = (result.get("structured_output") or {}).get("conversations")
    if result.get("is_error") or found is None:
        raise ValueError(result.get("result") or "no conversations")
    return found


def key(conversation):
    """Returns what identifies conversation across runs."""
    return f"{conversation['channel_id']}/{conversation['thread_ts']}"


def owner(conversation, texts, pr_owners):
    """Returns the project working on conversation, in the form of
    pull_request.owner: the latest project whose notes in texts, as
    (project, role, text) tuples, mention the thread, else the project
    of a pull request it links to, from pr_owners by url. Returns None
    if no project is."""
    ts = conversation["thread_ts"].replace(".", "")
    if ts:
        pattern = rf"(?<!\d)p?{ts}(?!\d)"
    else:
        pattern = rf"\b{re.escape(conversation['channel_id'])}\b"
    found = None
    for project, role, text in texts:
        if re.search(pattern, text) and (
                found is None or project > found["project"] or (
                    project == found["project"] and role)):
            found = {"project": project, "dir": None, "role": role}
    if found:
        return found
    for url in conversation.get("links") or []:
        if pr_owners.get(url):
            return pr_owners[url]
    return None


def events(old, conversations):
    """Returns the conversations that started waiting on the user, or
    got a new message while waiting, since old, the state remember
    returned last time. With no old state there are none."""
    if old is None:
        return []
    return [c for c in conversations
            if c["waiting_on_me"] and old.get(key(c)) != c["last_ts"]]


def remember(old, conversations, now, days=7):
    """Returns the state to compare the next conversations with: old
    updated with conversations, without those that have been quiet for
    days days before now, a Unix time."""
    state = dict(old or {})
    for c in conversations:
        state[key(c)] = c["last_ts"]

    def recent(ts):
        try:
            return float(ts) > now - days * 86400
        except ValueError:
            return False

    return {k: ts for k, ts in state.items() if recent(ts)}


def table(conversations, owners):
    """Returns lines listing conversations, those waiting on the user
    first, with the project name from owners (by key)."""
    rows = []
    for c in conversations:
        found = owners.get(key(c))
        name = ""
        if found:
            name = front_matter(found["project"], "name") or Path(found["project"]).name
        mark = "*" if c["waiting_on_me"] else " "
        rows.append((not c["waiting_on_me"],
                     f"{mark} {c['channel'][:26]:<26} {name:<20} {c['summary']}"))
    return [r for _, r in sorted(rows, key=lambda r: r[0])]


def poll(herdr, texts, path, pr_owners, fetch=fetch):
    """Checks the Slack conversations once with fetch: tells the user
    about those newly waiting on them since the state in path, saves the
    new state there, and returns the lines of table. herdr runs a herdr
    command. texts are the projects' notes, and pr_owners the projects
    of pull requests by url."""
    try:
        old = json.loads(path.read_text())
    except (OSError, ValueError):
        old = None
    path.parent.mkdir(parents=True, exist_ok=True)
    found = fetch(path.parent)
    owners = {key(c): owner(c, texts, pr_owners) for c in found}
    for c in events(old, found):
        project = owners.get(key(c))
        where = f" ({Path(project['project']).name})" if project else ""
        try:
            herdr("notification", "show", f"Slack {c['channel']}",
                  "--body", f"{c['summary']}{where}", "--sound", "request")
        except (OSError, subprocess.CalledProcessError):
            pass
    path.write_text(json.dumps(remember(old, found, datetime.now().timestamp()), indent=1))
    return table(found, owners)

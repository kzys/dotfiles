"""Finding the user's active Linear issues, by asking a headless Claude
session that has the Linear connector, and telling the user when one
starts waiting on them."""

import json
import re
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

from herdr_project import headless, inbox, pull_request
from herdr_project.notes import front_matter

SCHEMA = {
    "type": "object",
    "required": ["issues"],
    "properties": {"issues": {"type": "array", "items": {
        "type": "object",
        "required": ["identifier", "title", "state", "url", "updated_at",
                     "summary", "waiting_on_me"],
        "properties": {
            "identifier": {"type": "string"},
            "title": {"type": "string"},
            "state": {"type": "string"},
            "url": {"type": "string"},
            "updated_at": {"type": "string"},
            "summary": {"type": "string"},
            "waiting_on_me": {"type": "boolean"},
            "links": {"type": "array", "items": {"type": "string"}},
        },
    }}},
}

# The claude.ai connector the headless session needs.
CONNECTOR = "Linear"

TOOLS = [
    "mcp__claude_ai_Linear__list_issues",
    "mcp__claude_ai_Linear__get_issue",
    "mcp__claude_ai_Linear__list_comments",
    "mcp__claude_ai_Linear__get_user",
]


def prompt(created_since, recent_since):
    """Returns what to ask Claude for the issues assigned to the user,
    and those they created that changed since the date created_since,
    reading the comments of those that changed since recent_since."""
    return (
        "List my active Linear issues: issues assigned to me that are not "
        "completed or canceled, and issues I created that were updated since "
        f"{created_since:%Y-%m-%d} and are not completed or canceled. For each "
        f"issue updated since {recent_since:%Y-%m-%d}, read its comments. "
        "waiting_on_me is true when someone else commented after my last "
        "comment and asks or tells me something or mentions me, or the issue "
        f"was assigned to me since {recent_since:%Y-%m-%d}. summary is one "
        "line saying what is pending. updated_at is the ISO time of the last "
        "update. links are the GitHub pull request URLs attached to or "
        "mentioned in the issue. Do not change anything."
    )


def fetch(state_dir, command="claude"):
    """Returns the user's active Linear issues as the headless Claude
    session in state_dir reports them. Raises if it fails."""
    now = datetime.now().astimezone()
    return headless.ask(state_dir, prompt(now - timedelta(days=14), now - timedelta(days=3)),
                        SCHEMA, TOOLS, "issues", command)


def owner(issue, texts, pr_owners):
    """Returns the project working on issue, as pull_request.project_of
    finds it from texts and pr_owners: the one whose notes mention its
    identifier, else that of a pull request it links to."""
    pattern = rf"(?<![\w-]){re.escape(issue['identifier'])}(?!\d)"
    return pull_request.project_of(pattern, issue.get("links"), texts, pr_owners)


def events(old, issues):
    """Returns the issues that started waiting on the user, or changed
    while waiting, since old, the state remember returned last time.
    With no old state there are none."""
    if old is None:
        return []
    return [i for i in issues
            if i["waiting_on_me"] and old.get(i["identifier"]) != updated(i)]


def updated(issue):
    """Returns when issue was last updated, in UTC to the second, however
    Claude wrote it, if it is an ISO time."""
    try:
        at = datetime.fromisoformat(issue["updated_at"])
    except ValueError:
        return issue["updated_at"]
    if at.tzinfo:
        at = at.astimezone(UTC)
    return at.replace(tzinfo=None, microsecond=0).isoformat()


def remember(old, issues, now, days=30):
    """Returns the state to compare the next issues with: old updated
    with issues, so that one Claude leaves out once doesn't count as new
    when it is back, without those last updated days days before now."""
    state = dict(old or {})
    for i in issues:
        state[i["identifier"]] = updated(i)

    def recent(at):
        try:
            return datetime.fromisoformat(at).replace(tzinfo=UTC) > now - timedelta(days=days)
        except ValueError:
            return True  # Keep what Claude wrote oddly, or it notifies every time.

    return {k: at for k, at in state.items() if recent(at)}


def table(issues, owners):
    """Returns lines listing issues, those waiting on the user first,
    then the latest updated, with the project name from owners (by
    identifier)."""
    rows = []
    for i in sorted(issues, key=lambda i: i["updated_at"], reverse=True):
        found = owners.get(i["identifier"])
        name = ""
        if found:
            name = front_matter(found["project"], "name") or Path(found["project"]).name
        mark = "*" if i["waiting_on_me"] else " "
        rows.append((not i["waiting_on_me"], (f"{mark} {i['identifier']:<9} "
                                              f"{i['state'][:11]:<11} {name:<20} "
                                              f"{i['summary']}")))
    return [r for _, r in sorted(rows, key=lambda r: r[0])]


def poll(herdr, texts, path, pr_owners, fetch=fetch, now=None):
    """Checks the Linear issues once with fetch: tells the user about
    those newly waiting on them since the state in path, saves the new
    state there, and returns the lines of table and inbox items for the
    issues waiting on the user. herdr runs a herdr
    command. texts are the projects' notes, and pr_owners the projects
    of pull requests by url. now is the current time unless given."""
    try:
        old = json.loads(path.read_text())
    except (OSError, ValueError):
        old = None
    path.parent.mkdir(parents=True, exist_ok=True)
    found = fetch(path.parent)
    owners = {i["identifier"]: owner(i, texts, pr_owners) for i in found}
    for i in events(old, found):
        project = owners.get(i["identifier"])
        where = f" ({Path(project['project']).name})" if project else ""
        try:
            herdr("notification", "show", f"Linear {i['identifier']}",
                  "--body", f"{i['summary']}{where}", "--sound", "request")
        except (OSError, subprocess.CalledProcessError):
            pass
    now = now or datetime.now(UTC)
    path.write_text(json.dumps(remember(old, found, now), indent=1))
    items = [inbox.item(owners.get(i["identifier"]), "linear",
                        f"{i['identifier']}: {i['summary']}")
             for i in found if i["waiting_on_me"]]
    return table(found, owners), items

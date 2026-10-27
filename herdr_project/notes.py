"""Reading a project's notes: README.md and AGENT-<role>.md."""

import json
import re
from pathlib import Path

# How an agent reports its role, which names its notes file, to Herdr.
# Any command with this text counts, even one that only greps for it; a
# wrong role at worst shows the wrong notes, or all of them.
REPORT = re.compile(
    r'report-metadata\s+"?\$\{?HERDR_PANE_ID\}?"?.*--token role=([A-Za-z0-9_-]+)'
)


def front_matter(directory, key):
    """Returns field key from the front matter of README.md in
    directory, "" if it has no such field, or None if there is no
    README.md. The front matter starts at the first line, between lines
    of ---."""
    try:
        lines = (Path(directory) / "README.md").read_text(errors="replace").split("\n")
    except OSError:
        return None
    if not lines or lines[0] != "---":
        return ""
    for line in lines[1:]:
        if line == "---":
            break
        if line.startswith(f"{key}:"):
            return line[len(key) + 1:].strip()
    return ""


def report_title(workspace, directory, herdr):
    """Reports the title in the front matter of README.md in directory as
    the $title token of Herdr workspace, for the Spaces panel, if there is
    one. herdr runs a herdr command."""
    title = front_matter(directory, "title")
    if title:
        herdr("workspace", "report-metadata", workspace, "--source", "readme-title",
              "--token", f"title={title}")


def notes(directory, role=None):
    """Returns the notes in directory: AGENT-<role>.md if role is given
    and the file exists, else README.md, then every AGENT-*.md."""
    if not directory:
        return ""
    d = Path(directory)
    if role:
        try:
            return (d / f"AGENT-{role}.md").read_text(errors="replace")
        except OSError:
            pass
    texts = []
    for f in [d / "README.md", *sorted(d.glob("AGENT-*.md"))]:
        try:
            texts.append(f.read_text(errors="replace"))
        except OSError:
            pass
    return "".join(texts)


def reported_role(transcript):
    """Returns the role the claude session in transcript last reported
    for its own pane, or None."""
    role = None
    try:
        with open(transcript, "rb") as f:
            for line in f:
                if b"report-metadata" not in line:
                    continue
                try:
                    content = json.loads(line)["message"]["content"]
                except (ValueError, KeyError, TypeError):
                    continue
                for part in content if isinstance(content, list) else []:
                    if not isinstance(part, dict) or part.get("type") != "tool_use":
                        continue
                    tool_input = part.get("input")
                    if not isinstance(tool_input, dict):
                        continue
                    if m := REPORT.search(str(tool_input.get("command", ""))):
                        role = m.group(1)
    except OSError:
        pass
    return role

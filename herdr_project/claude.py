"""Reading Claude Code's session transcripts under ~/.claude/projects."""

import json
import re
from pathlib import Path


def transcript_dir(directory, home=None):
    """Returns where claude keeps the transcripts of the sessions in
    directory: under .claude/projects in home, by default the user's
    home, in a directory named after the path."""
    home = home or Path.home()
    return home / ".claude/projects" / re.sub("[^a-zA-Z0-9]", "-", str(directory))


def transcripts(directory, home=None):
    """Returns the transcripts of the sessions in directory, newest
    first. home is as for transcript_dir."""
    found = transcript_dir(directory, home).glob("*.jsonl")
    return sorted(found, key=lambda p: p.stat().st_mtime, reverse=True)


def title(transcript):
    """Returns the title of the session in transcript: the one it was
    renamed to, the one claude generated, or else its first prompt on
    one line, cut to 60 characters. Returns "" if there is none."""
    data = transcript.read_bytes()

    def field(marker, key, find):
        """Returns key from the first or last line containing marker."""
        i = find(marker)
        if i < 0:
            return None
        start = data.rfind(b"\n", 0, i) + 1
        end = data.find(b"\n", i)
        try:
            return json.loads(data[start : end if end >= 0 else None]).get(key)
        except ValueError:
            return None

    for marker, key in (
        (b'"type":"custom-title"', "customTitle"),
        (b'"type":"ai-title"', "aiTitle"),
    ):
        if value := field(marker, key, data.rfind):
            return value
    prompt = field(b'"lastPrompt"', "lastPrompt", data.find) or ""
    return " ".join(str(prompt).split())[:60]

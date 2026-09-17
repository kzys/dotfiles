"""Read session details from Claude Code transcripts under ~/.claude/projects."""

import glob
import json
import os

# How much of a transcript's end to scan. Turns are appended chronologically
# and the fields we want recur every turn, so this is plenty.
TAIL = 65536


class Transcripts:
    """Per-session details read from the tail of the session's .jsonl:
    git branch, time of the last record, the last user prompt, and the model
    and context size of the last assistant message.
    Results are cached by file size and mtime, so idle sessions cost a stat."""

    def __init__(self):
        self.cache = {}

    def info(self, session_id):
        paths = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{session_id}.jsonl"))
        if not paths:
            return {}
        # A session that changed directory (e.g. entered a worktree) can leave
        # a stale copy behind; take the most recently written one.
        path = max(paths, key=os.path.getmtime)
        st = os.stat(path)
        key = (path, st.st_size, st.st_mtime)
        if key not in self.cache:
            self.cache = {k: v for k, v in self.cache.items() if k[0] != path}
            self.cache[key] = self.read(path, st.st_size)
        return self.cache[key]

    @classmethod
    def read(cls, path, size, tail=None):
        """Scan the last `tail` bytes (default TAIL), then the whole file if
        that left fields unfilled: a few records (deferred tool lists) run
        to tens of KB and can push the rest out of the tail."""
        tail = TAIL if tail is None else tail
        with open(path, "rb") as f:
            f.seek(max(0, size - tail))
            lines = f.read().split(b"\n")
        if size > tail:
            lines = lines[1:]  # first line is probably cut off
        out = {}
        for line in reversed(lines):
            if len(out) == 5:
                break
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if "last" not in out and d.get("timestamp"):
                out["last"] = d["timestamp"]
            if "branch" not in out and d.get("gitBranch"):
                out["branch"] = d["gitBranch"]
            if "prompt" not in out and d.get("lastPrompt"):
                out["prompt"] = d["lastPrompt"]
            msg = d.get("message") or {}
            model = msg.get("model") if d.get("type") == "assistant" else None
            if "model" not in out and model and not model.startswith("<"):
                out["model"] = model
                # What the last request carried: everything the model read,
                # cached or not. This is the session's current context size.
                u = msg.get("usage") or {}
                out["context"] = sum(u.get(k) or 0 for k in (
                    "input_tokens", "cache_read_input_tokens",
                    "cache_creation_input_tokens"))
        if len(out) < 5 and size > tail:
            return cls.read(path, size, size)
        return out

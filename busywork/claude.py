"""Read sessions from Claude Code: `claude agents --json` for the list,
each session's transcript under ~/.claude/projects for the details and,
for a background job, its state under ~/.claude/jobs for what it says it
is doing."""

import glob
import json
import os
import subprocess
from dataclasses import replace

from session import Session, Transcript
from source import Source
from windows import Windows

# How much of a transcript's end to scan. Turns are appended chronologically
# and the fields we want recur every turn, so this is plenty.
TAIL = 65536


class Claude(Source):
    name = "claude"

    def __init__(self, exe="claude", home=None):
        self.exe = exe
        self.home = home or os.path.expanduser("~/.claude")
        self.windows = Windows()
        # What each file was last read as, keyed by its size and mtime too,
        # so an idle session costs a stat.
        self.cache = {}

    def version(self):
        """Claude Code's version, e.g. "2.1.274", or "" if unavailable."""
        try:
            out = subprocess.run([self.exe, "--version"], capture_output=True,
                                 text=True, check=True).stdout
        except (OSError, subprocess.CalledProcessError):
            return ""
        return out.split()[0] if out.split() else ""

    def sessions(self, show_all):
        cmd = [self.exe, "agents", "--json"]
        if show_all:
            cmd.append("--all")
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, check=True)
        except FileNotFoundError:
            return []
        rows = []
        for a in json.loads(out.stdout):
            sid = a.get("sessionId") or ""
            id = a.get("id") or sid
            rows.append(Session(
                id=id,
                name=a.get("name") or "",
                cwd=a.get("cwd") or "",
                state=a.get("state") or "",
                status=a.get("status") or "",
                pid=a.get("pid"),
                detail=self.detail(id),
                transcript=self.transcript(sid),
            ))
        return rows

    def read(self, path, parse, default):
        """parse(path, size) for a file, cached until its size or mtime
        changes; default when there is no such file."""
        try:
            st = os.stat(path)
        except OSError:
            return default
        key = (path, st.st_size, st.st_mtime)
        if key not in self.cache:
            self.cache = {k: v for k, v in self.cache.items() if k[0] != path}
            self.cache[key] = parse(path, st.st_size)
        return self.cache[key]

    def transcript(self, session_id):
        """The session's transcript details. A session that changed
        directory (e.g. entered a worktree) can leave a stale copy behind;
        take the most recently written one."""
        paths = glob.glob(os.path.join(
            self.home, "projects", "*", f"{session_id}.jsonl")) if session_id else []
        if not paths:
            return Transcript()
        path = max(paths, key=os.path.getmtime)
        t = self.read(path, self.read_transcript, Transcript())
        return replace(t, window=self.windows.get(t.model)) if t.model else t

    @classmethod
    def read_transcript(cls, path, size, tail=None):
        """The transcript's git branch, time of the last record, last user
        prompt, and the model and context size of the last assistant
        message, each from the newest record that has it. Scans the last
        `tail` bytes (default TAIL), then the whole file if that left fields
        unfilled: a few records (deferred tool lists) run to tens of KB and
        can push the rest out of the tail."""
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
            return cls.read_transcript(path, size, size)
        return Transcript(**out)

    def detail(self, job_id):
        """A background job's own one-line summary of what it is doing, from
        its state file. An interactive session has none."""
        path = os.path.join(self.home, "jobs", job_id, "state.json")
        return self.read(path, self.read_state, "") if job_id else ""

    @staticmethod
    def read_state(path, _size):
        with open(path, encoding="utf-8") as f:
            try:
                return json.load(f).get("detail") or ""
            except ValueError:
                return ""

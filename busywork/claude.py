"""Read sessions from Claude Code: `claude agents --json` for the list, each
session's transcript for the details and, for a background job, its state
file for what it says it is doing."""

import json
import subprocess

from jobs import Jobs
from source import Source
from transcripts import Transcripts
from windows import Windows


class Claude(Source):
    name = "claude"

    def __init__(self, exe="claude"):
        self.exe = exe
        self.transcripts = Transcripts()
        self.jobs = Jobs()
        self.windows = Windows()

    def version(self):
        """Claude Code's version, e.g. "2.1.274", or "" if unavailable."""
        try:
            out = subprocess.run([self.exe, "--version"], capture_output=True,
                                 text=True, check=True).stdout
        except (OSError, subprocess.CalledProcessError):
            return ""
        return out.split()[0] if out.split() else ""

    def sessions(self, show_all):
        """The rows `claude agents --json` gives, each with its transcript
        details merged in under "transcript" and its job state, if it is a
        background job, under "job"."""
        cmd = [self.exe, "agents", "--json"]
        if show_all:
            cmd.append("--all")
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, check=True)
        except FileNotFoundError:
            return []
        sessions = json.loads(out.stdout)
        for a in sessions:
            a.setdefault("id", a.get("sessionId"))
            try:
                a["job"] = self.jobs.info(a["id"])
            except OSError:
                a["job"] = {}
            try:
                a["transcript"] = self.transcripts.info(a.get("sessionId", ""))
            except OSError:
                a["transcript"] = {}
            model = a["transcript"].get("model")
            if model:
                a["transcript"]["window"] = self.windows.get(model)
        return sessions

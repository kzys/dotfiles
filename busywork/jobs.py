"""Read what a background Claude Code job says it is doing from
~/.claude/jobs/<id>/state.json. Interactive sessions have no such file."""

import json
import os


class Jobs:
    """Per-job details from the job's state file: "detail", the job's own
    one-line summary of what it is up to. Results are cached by mtime, so a
    quiet job costs a stat."""

    def __init__(self, root=None):
        self.root = root or os.path.expanduser("~/.claude/jobs")
        self.cache = {}

    def info(self, job_id):
        if not job_id:
            return {}
        path = os.path.join(self.root, job_id, "state.json")
        try:
            st = os.stat(path)
        except OSError:
            return {}
        key = (path, st.st_mtime)
        if key not in self.cache:
            self.cache = {k: v for k, v in self.cache.items() if k[0] != path}
            self.cache[key] = self.read(path)
        return self.cache[key]

    @staticmethod
    def read(path):
        with open(path, encoding="utf-8") as f:
            try:
                d = json.load(f)
            except ValueError:
                return {}
        return {"detail": d["detail"]} if d.get("detail") else {}

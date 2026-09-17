"""Find out each model's context window size from Claude Code itself."""

import json
import os
import subprocess


class Windows:
    """Context window size per model id, probed once with a one-token
    `claude -p` call (a real API request, so the answer is cached on disk)."""

    def __init__(self):
        cache = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
        self.path = os.path.join(cache, "busywork", "windows.json")
        try:
            with open(self.path) as f:
                self.sizes = json.load(f)
        except (OSError, ValueError):
            self.sizes = {}
        self.failed = set()

    def get(self, model):
        if model in self.sizes or model in self.failed:
            return self.sizes.get(model)
        try:
            out = subprocess.run(
                ["claude", "-p", "ok", "--model", model, "--output-format", "json",
                 "--max-turns", "1", "--no-session-persistence"],
                capture_output=True, text=True, check=True, timeout=120).stdout
            usage = json.loads(out).get("modelUsage") or {}
        except (OSError, ValueError, subprocess.SubprocessError):
            self.failed.add(model)
            return None
        # The reply may involve more than the requested model; keep them all.
        for m, u in usage.items():
            if u.get("contextWindow"):
                self.sizes[m] = u["contextWindow"]
        if model not in self.sizes:
            self.failed.add(model)
            return None
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            with open(self.path, "w") as f:
                json.dump(self.sizes, f)
        except OSError:
            pass
        return self.sizes[model]

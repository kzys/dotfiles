"""Read sessions from the opencode background server."""

import base64
import json
import os
import subprocess
import urllib.error
import urllib.request
from datetime import datetime, timezone

from session import Session, Transcript
from source import Source

# Messages to look back through for the last prompt and assistant reply.
MESSAGES = 20

# What a finished session's outcome means in Claude's terms. An interrupted
# one is just idle, like one that was never asked anything.
OUTCOMES = {"succeeded": "done", "failed": "failed"}

TIMEOUT = 5


class OpenCode(Source):
    """Sessions of the opencode server, found through `opencode service
    status` and read over its HTTP API. Message reads are cached by the
    session's update time."""

    name = "opencode"

    def __init__(self, exe="opencode"):
        self.exe = exe
        self.url = None
        self.missing = False
        self.windows = None
        self.cache = {}

    def version(self):
        """opencode's version, e.g. "v2.0.5", or ""."""
        try:
            out = subprocess.run([self.exe, "--version"], capture_output=True,
                                 text=True, check=True, timeout=TIMEOUT).stdout
        except (OSError, subprocess.SubprocessError):
            return ""
        return out.split()[-1] if out.split() else ""

    def sessions(self, show_all):
        if self.missing:
            return []
        try:
            return self.fetch(show_all)
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, OSError):
            # Can't reach the server: it stopped, or restarted on another
            # port. Look it up again next time rather than failing forever.
            self.url = None
            return []

    def fetch(self, show_all):
        if self.url is None:
            self.url = self.find()
            if self.url is None:
                return []
        active = self.get("/api/session/active")
        pending = set()
        for path in ("/api/permission/request", "/api/form"):
            pending.update(r.get("sessionID") for r in self.get(path))
        rows = []
        for s in self.get("/api/session"):
            if s.get("parentID"):
                continue  # a subagent, shown through its parent
            if s["id"] in pending:
                state = "blocked"
            elif s["id"] in active:
                state = "working"
            else:
                state = OUTCOMES.get(s.get("outcome"), "")
            if not (show_all or state in ("blocked", "working")):
                continue
            rows.append(self.row(s, state, self.messages(s)))
        return rows

    def find(self):
        """The server's URL from `opencode service status`, or None."""
        try:
            out = subprocess.run([self.exe, "service", "status"],
                                 capture_output=True, text=True, check=True,
                                 timeout=TIMEOUT).stdout
        except FileNotFoundError:
            self.missing = True
            return None
        except (OSError, subprocess.SubprocessError):
            return None
        for word in out.split():
            if word.startswith("http://") or word.startswith("https://"):
                return word.rstrip("/")
        return None

    def get(self, path):
        """The `data` of a GET on the server. The server takes basic auth
        with the password it wrote to its config directory."""
        req = urllib.request.Request(self.url + path)
        password = self.password()
        if password:
            token = base64.b64encode(f"opencode:{password}".encode()).decode()
            req.add_header("Authorization", "Basic " + token)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.load(r)["data"]

    @staticmethod
    def password():
        config = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
        try:
            with open(os.path.join(config, "opencode", "service.json")) as f:
                return json.load(f).get("password")
        except (OSError, ValueError):
            return None

    def messages(self, s):
        """The last MESSAGES messages of a session, newest first, cached
        until the session is updated again."""
        key = (s["id"], (s.get("time") or {}).get("updated"))
        if key not in self.cache:
            self.cache = {k: v for k, v in self.cache.items() if k[0] != s["id"]}
            self.cache[key] = self.get(
                f"/api/session/{s['id']}/message?limit={MESSAGES}&order=desc")
        return self.cache[key]

    def window(self, model):
        """A model's context window from the server's model list, probed
        once and again only when a model it didn't list shows up."""
        key = (model.get("providerID"), model.get("id"))
        if self.windows is None or key not in self.windows:
            self.windows = {}
            for m in self.get("/api/model"):
                self.windows[(m.get("providerID"), m.get("id"))] = (
                    (m.get("limit") or {}).get("context"))
            self.windows.setdefault(key, None)
        return self.windows[key]

    def row(self, s, state, messages):
        t = Transcript()
        for m in messages:
            if t.prompt is None and m.get("type") == "user" and m.get("text"):
                t.prompt = m["text"]
            if t.model is None and m.get("type") == "assistant" and m.get("model"):
                model = m["model"]
                t.model = model.get("id") or ""
                tokens = m.get("tokens") or {}
                cache = tokens.get("cache") or {}
                t.context = sum(x or 0 for x in (
                    tokens.get("input"), cache.get("read"), cache.get("write")))
                t.window = self.window(model)
        updated = (s.get("time") or {}).get("updated")
        if updated:
            t.last = datetime.fromtimestamp(
                updated / 1000, timezone.utc).isoformat()
        return Session(
            id=s["id"],
            name=s.get("title") or s.get("slug") or "",
            cwd=(s.get("location") or {}).get("directory") or "",
            state=state,
            status="busy" if state == "working" else "",
            transcript=t,
        )

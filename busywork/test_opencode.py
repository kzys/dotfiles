import urllib.error

import pytest

from opencode import OpenCode
from session import Transcript


def session(id, outcome=None, **fields):
    s = {"id": id, "time": {"created": 1000, "updated": 1789617842914},
         "location": {"directory": "/home/me/ws"}, **fields}
    if outcome:
        s["outcome"] = outcome
    return s


MODEL = {"id": "big-pickle", "providerID": "opencode"}


class Fake(OpenCode):
    """An OpenCode over canned responses instead of a server."""

    def __init__(self, responses):
        super().__init__()
        self.url = "http://fake"
        self.responses = responses
        self.calls = []

    def get(self, path):
        self.calls.append(path)
        for prefix, data in self.responses.items():
            if path.startswith(prefix):
                return data
        raise urllib.error.HTTPError(path, 404, "Not Found", {}, None)


def fake(sessions, active=(), permissions=(), forms=(), messages=()):
    return Fake({
        "/api/session/active": {id: {"type": "running"} for id in active},
        "/api/permission/request": [{"sessionID": id} for id in permissions],
        "/api/form": [{"sessionID": id} for id in forms],
        "/api/session/ses": list(messages),
        "/api/session": sessions,
        "/api/model": [{"id": "big-pickle", "providerID": "opencode",
                        "limit": {"context": 200000}}],
    })


def test_state_from_pending_active_and_outcome():
    oc = fake([session("ses_a"), session("ses_b"), session("ses_c", "failed"),
               session("ses_d", "succeeded"), session("ses_e", "interrupted")],
              active=["ses_a", "ses_b"], permissions=["ses_b"])
    rows = {r.id: r for r in oc.sessions(True)}
    assert rows["ses_a"].state == "working"
    assert rows["ses_a"].status == "busy"
    assert rows["ses_b"].state == "blocked"
    assert rows["ses_c"].state == "failed"
    assert rows["ses_d"].state == "done"
    assert rows["ses_e"].state == ""


def test_live_keeps_only_running_and_blocked():
    oc = fake([session("ses_a"), session("ses_b"), session("ses_c", "succeeded")],
              active=["ses_a"], forms=["ses_b"])
    assert [r.id for r in oc.sessions(False)] == ["ses_a", "ses_b"]


def test_subagents_are_skipped():
    oc = fake([session("ses_a"), session("ses_b", parentID="ses_a")])
    assert [r.id for r in oc.sessions(True)] == ["ses_a"]


def test_row_takes_details_from_newest_messages():
    oc = fake([session("ses_a", title="Poem")], messages=[
        {"type": "assistant", "model": MODEL,
         "tokens": {"input": 100, "cache": {"read": 20, "write": 3}}},
        {"type": "user", "text": "second"},
        {"type": "assistant", "model": {"id": "old", "providerID": "opencode"},
         "tokens": {"input": 1}},
        {"type": "user", "text": "first"},
    ])
    [row] = oc.sessions(True)
    assert row.name == "Poem"
    assert row.cwd == "/home/me/ws"
    assert row.transcript == Transcript(
        model="big-pickle",
        context=123,
        window=200000,
        prompt="second",
        last="2026-09-17T04:04:02.914000+00:00",
    )


def test_unknown_model_has_no_window():
    oc = fake([session("ses_a")], messages=[
        {"type": "assistant", "model": {"id": "new", "providerID": "x"},
         "tokens": {"input": 1}}])
    [row] = oc.sessions(True)
    assert row.transcript.window is None
    oc.sessions(True)
    assert oc.calls.count("/api/model") == 1


def test_messages_are_cached_until_the_session_updates():
    oc = fake([session("ses_a")])
    oc.sessions(True)
    oc.sessions(True)
    assert sum(p.startswith("/api/session/ses_a/message") for p in oc.calls) == 1
    oc.responses["/api/session"][0]["time"]["updated"] += 1
    oc.sessions(True)
    assert sum(p.startswith("/api/session/ses_a/message") for p in oc.calls) == 2


def test_unreachable_server_gives_no_rows_and_a_fresh_lookup():
    def refuse(path):
        raise urllib.error.URLError("Connection refused")
    oc = Fake({})
    oc.get = refuse
    assert oc.sessions(True) == []
    assert oc.url is None


def test_server_errors_raise():
    oc = Fake({})
    with pytest.raises(urllib.error.HTTPError):
        oc.sessions(True)


def test_missing_binary_gives_no_rows():
    oc = OpenCode(exe="no-such-opencode")
    assert oc.sessions(True) == []
    assert oc.missing

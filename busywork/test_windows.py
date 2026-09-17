import json
import subprocess

import pytest

import windows
from windows import Windows


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    return tmp_path / "busywork" / "windows.json"


class FakeClaude:
    """Stands in for subprocess.run: records calls and answers `claude -p`
    with whatever modelUsage is set, or fails if it is None."""

    def __init__(self):
        self.calls = []
        self.usage = None

    def __call__(self, cmd, **kw):
        self.calls.append(cmd)
        if self.usage is None:
            raise subprocess.CalledProcessError(1, cmd)
        out = json.dumps({"modelUsage": self.usage})
        return subprocess.CompletedProcess(cmd, 0, out, "")


@pytest.fixture
def claude(monkeypatch):
    fake = FakeClaude()
    monkeypatch.setattr(windows.subprocess, "run", fake)
    return fake


def test_probes_the_model_and_caches_the_answer(cache, claude):
    claude.usage = {"claude-opus-5": {"contextWindow": 1000000},
                    "claude-haiku-4-5": {"contextWindow": 200000}}
    w = Windows()
    assert w.get("claude-opus-5") == 1000000
    assert claude.calls[0][:5] == ["claude", "-p", "ok", "--model", "claude-opus-5"]
    assert "--no-session-persistence" in claude.calls[0]
    # Every model in the reply is kept, so no second probe for haiku.
    assert w.get("claude-haiku-4-5") == 200000
    assert len(claude.calls) == 1
    assert json.loads(cache.read_text()) == {
        "claude-opus-5": 1000000, "claude-haiku-4-5": 200000}


def test_reads_the_cache_instead_of_probing(cache, claude):
    cache.parent.mkdir(parents=True)
    cache.write_text(json.dumps({"claude-opus-5": 1000000}))
    assert Windows().get("claude-opus-5") == 1000000
    assert claude.calls == []


def test_a_failed_probe_is_not_retried(cache, claude):
    w = Windows()
    assert w.get("claude-opus-5") is None
    assert w.get("claude-opus-5") is None
    assert len(claude.calls) == 1
    assert not cache.exists()


def test_a_reply_without_the_model_counts_as_failed(cache, claude):
    claude.usage = {"claude-haiku-4-5": {"contextWindow": 200000}}
    w = Windows()
    assert w.get("claude-opus-5") is None
    assert w.get("claude-opus-5") is None
    assert len(claude.calls) == 1

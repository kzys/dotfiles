import importlib.machinery
import importlib.util
import pathlib

import pytest


def load(path):
    """Import a script that has no .py suffix."""
    loader = importlib.machinery.SourceFileLoader(path.name, str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


app = load(pathlib.Path(__file__).resolve().parent / "claude-agents-watch")


@pytest.mark.parametrize("seconds, text", [
    (0, "now"),
    (59, "now"),
    (60, "1m"),
    (3599, "59m"),
    (3600, "1h"),
    (86399, "23h"),
    (86400, "1d"),
    (10 * 86400, "10d"),
])
def test_duration_is_coarse(seconds, text):
    assert app.duration(seconds) == text


def test_context_with_and_without_a_window():
    assert app.context(None, 1000000) == ""
    assert app.context(0, 1000000) == ""
    assert app.context(146900, None) == "147k"
    assert app.context(146900, 1000000) == "147k 15%"
    assert app.context(999, 200000) == "1k 0%"


def test_short_cwd(monkeypatch):
    monkeypatch.setenv("HOME", "/home/me")
    assert app.short_cwd("/home/me") == "~"
    assert app.short_cwd("/home/me/ws/x") == "~/ws/x"
    assert app.short_cwd("/home/meow/x") == "/home/meow/x"
    assert app.short_cwd("/home/me/ws/x/.claude/worktrees/wt") == "~/ws/x [wt]"


def test_first_line_keeps_only_the_first_line_and_clips():
    assert app.first_line("  hello\nworld ") == "hello"
    assert app.first_line("x" * 200, limit=10) == "x" * 9 + "…"
    assert app.first_line("x" * 10, limit=10) == "x" * 10


def test_sort_key_puts_live_busy_and_newest_first():
    live_busy = {"pid": 1, "status": "busy", "startedAt": 100}
    live_idle_new = {"pid": 2, "status": "idle", "startedAt": 300}
    live_idle_old = {"pid": 3, "status": "idle", "startedAt": 200}
    done = {"pid": None, "status": None, "startedAt": 900}
    rows = [done, live_idle_old, live_idle_new, live_busy]
    assert sorted(rows, key=app.sort_key) == [
        live_busy, live_idle_new, live_idle_old, done]

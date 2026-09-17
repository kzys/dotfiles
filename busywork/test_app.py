import importlib.machinery
import importlib.util
import pathlib

import pytest

from session import Session, Transcript


def load(path):
    """Import a script that has no .py suffix."""
    loader = importlib.machinery.SourceFileLoader(path.name, str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


app = load(pathlib.Path(__file__).resolve().parent / "busywork")


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


def at(hour):
    """A transcript last touched at a fixed past time; a later hour is more
    recent, so it sorts higher."""
    return Transcript(last=f"2026-09-15T{hour:02d}:00:00Z")


def S(**fields):
    return Session(id="", **fields)


def test_sort_key_puts_sessions_wanting_the_user_first():
    blocked = S(state="blocked", transcript=at(1))
    waiting = S(pid=4, status="waiting", transcript=at(2))
    live_idle_new = S(pid=2, status="idle", transcript=at(4))
    live_idle_old = S(pid=3, status="idle", transcript=at(3))
    live_busy = S(pid=1, status="busy", transcript=at(6))
    working = S(state="working", transcript=at(5))
    done = S(state="done", transcript=at(8))
    failed = S(state="failed", transcript=at(7))
    rows = [done, live_busy, live_idle_old, failed, working, blocked,
            live_idle_new, waiting]
    assert sorted(rows, key=app.sort_key) == [
        waiting, blocked, live_idle_new, live_idle_old, live_busy, working,
        done, failed]


def test_mark_animates_blocked_and_running_only():
    assert app.mark(S(state="blocked"), 0) == app.WAVE[0]
    assert app.mark(S(state="working"), 0) == app.RUN[0]
    assert app.mark(S(status="busy"), 0) == app.RUN[0]
    assert app.mark(S(status="idle", pid=1), 0) == ""
    assert app.mark(S(state="done"), 0) == ""
    assert app.mark(S(state="failed"), 0) == ""


def test_mark_advances_a_frame_at_a_time_and_wraps():
    working = S(state="working")
    frames = [app.mark(working, f) for f in range(len(app.RUN))]
    assert frames == app.RUN
    assert app.mark(working, len(app.RUN)) == app.RUN[0]


def test_sort_key_ranks_recent_activity_over_an_early_start():
    old_start = S(pid=1, status="idle", transcript=at(9))
    new_start = S(pid=2, status="idle", transcript=at(8))
    assert sorted([new_start, old_start], key=app.sort_key) == [old_start,
                                                                new_start]


def test_sort_key_puts_sessions_without_a_transcript_last():
    quiet = S(pid=1, status="idle")
    active = S(pid=2, status="idle", transcript=at(3))
    assert sorted([quiet, active], key=app.sort_key) == [active, quiet]
    assert app.last_seen(quiet) == float("inf")


def test_context_full_only_over_the_threshold_and_with_both_numbers():
    assert app.context_full(91000, 100000) is True
    assert app.context_full(90000, 100000) is False
    assert app.context_full(100000, 100000) is True
    assert app.context_full(99000, None) is False
    assert app.context_full(None, 100000) is False
    assert app.context_full(0, 100000) is False


def test_row_tag_prefers_a_full_context_over_the_state():
    room = Transcript(context=50000, window=100000)
    tight = Transcript(context=95000, window=100000)
    assert app.row_tag(S(state="working", transcript=room)) == "working"
    assert app.row_tag(S(state="working", transcript=tight)) == "full"
    assert app.row_tag(S(state="done", transcript=tight)) == "full"
    assert app.row_tag(S(state="done")) == "done"
    assert app.row_tag(S()) == ""
    assert "full" in app.ROW_COLORS


def test_doing_prefers_the_sessions_own_account():
    assert app.doing(S(transcript=Transcript(prompt="p"))) == "p"
    assert app.doing(S(detail="d", transcript=Transcript(prompt="p"))) == "d"
    assert app.doing(S()) == ""

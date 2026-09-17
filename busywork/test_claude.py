import json
import os
import stat

import pytest

import claude
from claude import Claude
from session import Session, Transcript


def fake_claude(tmp_path, sessions):
    """A `claude` that prints the given sessions for `agents`, with an
    empty ~/.claude beside it."""
    exe = tmp_path / "claude"
    exe.write_text("#!/bin/sh\n"
                   "case $1 in --version) echo '9.9.9 (Claude Code)';;\n"
                   f"agents) cat {tmp_path / 'agents.json'};; esac\n")
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR)
    (tmp_path / "agents.json").write_text(json.dumps(sessions))
    return Claude(exe=str(exe), home=str(tmp_path / ".claude"))


def test_rows_get_an_id_and_their_details(tmp_path, monkeypatch):
    c = fake_claude(tmp_path, [{"id": "abc", "sessionId": "s1", "name": "x",
                                "pid": 7, "status": "busy", "state": "working"},
                               {"sessionId": "s2"}])
    monkeypatch.setattr(c, "transcript",
                        lambda sid: Transcript(model="m") if sid == "s1" else Transcript())
    monkeypatch.setattr(c, "detail", lambda jid: "d" if jid == "abc" else "")
    assert c.version() == "9.9.9"
    assert c.sessions(True) == [
        Session(id="abc", name="x", pid=7, status="busy", state="working",
                detail="d", transcript=Transcript(model="m")),
        Session(id="s2"),
    ]


def test_missing_binary_gives_no_rows_and_no_version():
    c = Claude(exe=os.path.join(os.sep, "no", "such", "claude"))
    assert c.sessions(True) == []
    assert c.version() == ""


# Transcripts

def record(**fields):
    return json.dumps(fields).encode() + b"\n"


def assistant(model, **usage):
    return record(type="assistant", timestamp="2026-09-16T01:00:00.000Z",
                  message={"model": model, "usage": usage})


def read(tmp_path, data):
    p = tmp_path / "s.jsonl"
    p.write_bytes(data)
    return Claude.read_transcript(str(p), p.stat().st_size)


def test_takes_each_field_from_its_newest_record(tmp_path):
    t = read(tmp_path,
        record(type="user", timestamp="2026-09-16T00:00:00.000Z", gitBranch="old")
        + record(type="last-prompt", lastPrompt="first")
        + assistant("claude-sonnet-5", input_tokens=1)
        + record(type="last-prompt", lastPrompt="second")
        + assistant("claude-opus-5", input_tokens=2,
                    cache_read_input_tokens=100, cache_creation_input_tokens=10)
        + record(type="user", timestamp="2026-09-16T02:00:00.000Z", gitBranch="new"))
    assert t == Transcript(
        last="2026-09-16T02:00:00.000Z",
        branch="new",
        prompt="second",
        model="claude-opus-5",
        context=112,
    )


def test_skips_synthetic_models(tmp_path):
    t = read(tmp_path, assistant("claude-opus-5", input_tokens=5)
             + assistant("<synthetic>", input_tokens=0))
    assert t.model == "claude-opus-5"
    assert t.context == 5


def test_ignores_lines_that_are_not_json(tmp_path):
    t = read(tmp_path, b"garbage\n" + record(type="last-prompt", lastPrompt="p")
             + b"{truncated")
    assert t == Transcript(prompt="p")


def test_empty_file(tmp_path):
    assert read(tmp_path, b"") == Transcript()


def test_drops_the_partial_first_line_of_a_long_file(tmp_path, monkeypatch):
    # The line straddling the tail boundary must not be parsed as if it
    # were whole, even when the cut happens to leave valid JSON.
    monkeypatch.setattr(claude, "TAIL", 64)
    padding = record(type="last-prompt", lastPrompt="x" * 100)
    t = read(tmp_path, padding + record(type="last-prompt", lastPrompt="tail"))
    assert t.prompt == "tail"


def test_scans_the_whole_file_when_the_tail_lacks_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(claude, "TAIL", 64)
    t = read(tmp_path, assistant("claude-opus-5", input_tokens=7)
             + record(type="last-prompt", lastPrompt="p" * 100))
    assert t.model == "claude-opus-5"
    assert t.prompt == "p" * 100


@pytest.fixture
def home(tmp_path):
    """A Claude over a fake ~/.claude, with writers for session and job
    files that take an mtime."""
    c = Claude(home=str(tmp_path))

    def write(path, data, mtime):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        os.utime(path, (mtime, mtime))
        return path

    c.session = lambda project, sid, data, mtime: write(
        tmp_path / "projects" / project / f"{sid}.jsonl", data, mtime)
    c.job = lambda jid, data, mtime: write(
        tmp_path / "jobs" / jid / "state.json", data, mtime)
    return c


def test_missing_session_and_job(home):
    assert home.transcript("nope") == Transcript()
    assert home.transcript("") == Transcript()
    assert home.detail("nope") == ""
    assert home.detail("") == ""


def test_prefers_the_most_recently_written_copy(home):
    home.session("-old", "sid", record(type="last-prompt", lastPrompt="old"), 100)
    home.session("-new", "sid", record(type="last-prompt", lastPrompt="new"), 200)
    assert home.transcript("sid").prompt == "new"


def test_looks_up_the_window_of_the_model(home, monkeypatch):
    home.session("-p", "sid", assistant("claude-opus-5", input_tokens=1), 100)
    monkeypatch.setattr(home.windows, "get", lambda model: 1000)
    assert home.transcript("sid").window == 1000


def test_rereads_only_when_the_file_changes(home, monkeypatch):
    p = home.session("-p", "sid", record(type="last-prompt", lastPrompt="a"), 100)
    reads = []
    real = Claude.read_transcript
    monkeypatch.setattr(Claude, "read_transcript",
                        classmethod(lambda cls, *a: reads.append(a) or real(*a)))
    assert home.transcript("sid").prompt == "a"
    assert home.transcript("sid").prompt == "a"
    assert len(reads) == 1
    p.write_bytes(record(type="last-prompt", lastPrompt="b"))
    os.utime(p, (200, 200))
    assert home.transcript("sid").prompt == "b"
    assert len(reads) == 2
    assert len(home.cache) == 1


# Jobs

def test_detail_comes_from_the_job_state(home):
    home.job("j1", json.dumps({"state": "working", "detail": "waiting on tempo"}).encode(), 100)
    home.job("j2", json.dumps({"state": "working"}).encode(), 100)
    home.job("j3", b"{not json", 100)
    assert home.detail("j1") == "waiting on tempo"
    assert home.detail("j2") == ""
    assert home.detail("j3") == ""

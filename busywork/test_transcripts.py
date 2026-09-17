import json
import os

import pytest

import transcripts
from transcripts import Transcripts


def record(**fields):
    return json.dumps(fields).encode() + b"\n"


def assistant(model, **usage):
    return record(type="assistant", timestamp="2026-09-16T01:00:00.000Z",
                  message={"model": model, "usage": usage})


def read(tmp_path, data):
    p = tmp_path / "s.jsonl"
    p.write_bytes(data)
    return Transcripts.read(str(p), p.stat().st_size)


def test_takes_each_field_from_its_newest_record(tmp_path):
    info = read(tmp_path,
        record(type="user", timestamp="2026-09-16T00:00:00.000Z", gitBranch="old")
        + record(type="last-prompt", lastPrompt="first")
        + assistant("claude-sonnet-5", input_tokens=1)
        + record(type="last-prompt", lastPrompt="second")
        + assistant("claude-opus-5", input_tokens=2,
                    cache_read_input_tokens=100, cache_creation_input_tokens=10)
        + record(type="user", timestamp="2026-09-16T02:00:00.000Z", gitBranch="new"))
    assert info == {
        "last": "2026-09-16T02:00:00.000Z",
        "branch": "new",
        "prompt": "second",
        "model": "claude-opus-5",
        "context": 112,
    }


def test_skips_synthetic_models(tmp_path):
    info = read(tmp_path, assistant("claude-opus-5", input_tokens=5)
                + assistant("<synthetic>", input_tokens=0))
    assert info["model"] == "claude-opus-5"
    assert info["context"] == 5


def test_ignores_lines_that_are_not_json(tmp_path):
    info = read(tmp_path, b"garbage\n" + record(type="last-prompt", lastPrompt="p")
                + b"{truncated")
    assert info == {"prompt": "p"}


def test_empty_file(tmp_path):
    assert read(tmp_path, b"") == {}


def test_drops_the_partial_first_line_of_a_long_file(tmp_path, monkeypatch):
    # The line straddling the tail boundary must not be parsed as if it
    # were whole, even when the cut happens to leave valid JSON.
    monkeypatch.setattr(transcripts, "TAIL", 64)
    padding = record(type="last-prompt", lastPrompt="x" * 100)
    info = read(tmp_path, padding + record(type="last-prompt", lastPrompt="tail"))
    assert info["prompt"] == "tail"


def test_scans_the_whole_file_when_the_tail_lacks_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(transcripts, "TAIL", 64)
    info = read(tmp_path, assistant("claude-opus-5", input_tokens=7)
                + record(type="last-prompt", lastPrompt="p" * 100))
    assert info["model"] == "claude-opus-5"
    assert info["prompt"] == "p" * 100


@pytest.fixture
def projects(tmp_path, monkeypatch):
    """A fake ~/.claude/projects; returns a writer for session files."""
    monkeypatch.setenv("HOME", str(tmp_path))
    root = tmp_path / ".claude" / "projects"

    def write(project, session, data, mtime):
        d = root / project
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{session}.jsonl"
        p.write_bytes(data)
        os.utime(p, (mtime, mtime))
        return p

    return write


def test_missing_session(projects):
    assert Transcripts().info("nope") == {}


def test_prefers_the_most_recently_written_copy(projects):
    projects("-old", "sid", record(type="last-prompt", lastPrompt="old"), 100)
    projects("-new", "sid", record(type="last-prompt", lastPrompt="new"), 200)
    assert Transcripts().info("sid")["prompt"] == "new"


def test_rereads_only_when_the_file_changes(projects, monkeypatch):
    p = projects("-p", "sid", record(type="last-prompt", lastPrompt="a"), 100)
    reads = []
    real = Transcripts.read
    monkeypatch.setattr(Transcripts, "read",
                        staticmethod(lambda *a: reads.append(a) or real(*a)))
    t = Transcripts()
    assert t.info("sid")["prompt"] == "a"
    assert t.info("sid")["prompt"] == "a"
    assert len(reads) == 1
    p.write_bytes(record(type="last-prompt", lastPrompt="b"))
    os.utime(p, (200, 200))
    assert t.info("sid")["prompt"] == "b"
    assert len(reads) == 2
    assert len(t.cache) == 1

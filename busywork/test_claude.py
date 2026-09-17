import json
import os
import stat

from claude import Claude


def fake_claude(tmp_path, sessions):
    """A `claude` that prints the given sessions for `agents`."""
    exe = tmp_path / "claude"
    exe.write_text("#!/bin/sh\n"
                   "case $1 in --version) echo '9.9.9 (Claude Code)';;\n"
                   f"agents) cat {tmp_path / 'agents.json'};; esac\n")
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR)
    (tmp_path / "agents.json").write_text(json.dumps(sessions))
    return Claude(exe=str(exe))


def test_rows_get_an_id_and_transcript_details(tmp_path, monkeypatch):
    c = fake_claude(tmp_path, [{"id": "abc", "sessionId": "s1", "name": "x"},
                               {"sessionId": "s2", "status": "busy"}])
    monkeypatch.setattr(c.transcripts, "info",
                        lambda sid: {"model": "m"} if sid == "s1" else {})
    monkeypatch.setattr(c.windows, "get", lambda model: 1000)
    assert c.version() == "9.9.9"
    assert c.sessions(True) == [
        {"id": "abc", "sessionId": "s1", "name": "x",
         "transcript": {"model": "m", "window": 1000}},
        {"id": "s2", "sessionId": "s2", "status": "busy", "transcript": {}},
    ]


def test_missing_binary_gives_no_rows_and_no_version():
    c = Claude(exe=os.path.join(os.sep, "no", "such", "claude"))
    assert c.sessions(True) == []
    assert c.version() == ""

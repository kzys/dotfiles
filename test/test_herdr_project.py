import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from herdr_project import claude
from herdr_project.herdr import herdr
from herdr_project.match import clip, columns, spans, visible
from herdr_project.notes import front_matter, notes, reported_role
from herdr_project.remaining import follow_remaining


def test_filters_sessions_by_project():
    rows = [
        ('new', '', '', '+ new project'),
        ('project', '/foo', '', '20261011-a  Foo work'),
        ('session', '/foo', '1', '    10-11 17:00  Bar fix'),
        ('session', '/foo', '2', '    10-11 16:00  Baz fix'),
        ('project', '/qux', '', '20261010-b  Qux work'),
        ('session', '/qux', '3', '    10-10 17:00  Bar fix'),
    ]
    assert visible(rows, '') == list(range(6))
    assert visible(rows, 'foo') == [1, 2, 3]
    assert visible(rows, 'foo bar') == [1, 2]
    assert visible(rows, 'bar') == [1, 2, 4, 5]
    assert visible(rows, 'Bar') == [1, 2, 4, 5]
    assert visible(rows, 'BAR') == []
    assert spans(['work', 'x'], 'Foo work') == [(4, 8)]
    assert spans(['foo'], 'İx foo') == [(3, 6)]


def test_clips_wide_text():
    assert columns('a税b') == 4
    assert clip('a税b', 2) == 'a'
    assert clip('a税b', 3) == 'a税'


def test_reads_notes(tmp_path):
    (tmp_path / 'README.md').write_text('readme\n')
    (tmp_path / 'AGENT-b.md').write_text('b\n')
    (tmp_path / 'AGENT-a.md').write_text('a\n')
    assert notes(str(tmp_path)) == 'readme\na\nb\n'
    assert notes(str(tmp_path), 'b') == 'b\n'
    assert notes(str(tmp_path), 'c') == 'readme\na\nb\n'
    assert notes('') == ''


def test_reads_reported_role(tmp_path):
    def bash(command):
        return json.dumps({'type': 'assistant', 'message': {'content': [
            {'type': 'tool_use', 'name': 'Bash', 'input': {'command': command}}]}})

    transcript = tmp_path / 'session.jsonl'
    transcript.write_text('\n'.join([
        json.dumps({'type': 'user', 'message': {'content': 'report-metadata --token role=no'}}),
        bash('herdr pane report-metadata "$HERDR_PANE_ID" --source agent-notes --token role=main'),
        bash('herdr pane report-metadata w1:p2 --source agent-notes --token role=other'),
        bash('herdr pane report-metadata "$HERDR_PANE_ID" --source agent-notes --token role=tester'),
        json.dumps({'message': {'content': [{'type': 'tool_use', 'input': 'report-metadata'}]}}),
    ]) + '\n')
    assert reported_role(transcript) == 'tester'
    assert reported_role(tmp_path / 'missing.jsonl') is None


def test_remaining_waits_for_role_and_ends_when_pane_exits(tmp_path, capsys):
    path = tmp_path / 'herdr.sock'
    server = socket.socket(socket.AF_UNIX)
    server.bind(str(path))
    server.listen()
    server.settimeout(5)
    conns = []
    subscriptions = []

    def herdr_server():
        conn, _ = server.accept()
        conns.append(conn)
        subscriptions.extend(json.loads(conn.makefile().readline())['params']['subscriptions'])
        conn.sendall(b'{"data":{"pane_id":"p","type":"pane_exited"},"event":"pane_exited"}\n')

    # The pane is there for two polls, so a missed event ends the test
    # after the second five-second poll instead of hanging.
    replies = [{'result': {'pane': {}}}] * 2

    thread = threading.Thread(target=herdr_server, daemon=True)
    thread.start()
    def fake_herdr(*args):
        if not replies:
            raise subprocess.CalledProcessError(1, ['herdr', *args])
        return replies.pop()

    start = time.monotonic()
    follow_remaining('p', fake_herdr, str(path))
    elapsed = time.monotonic() - start
    thread.join(5)
    for conn in conns:
        conn.close()
    server.close()
    assert elapsed < 4
    assert 'Waiting for the agent to report its role.' in capsys.readouterr().out
    assert {'type': 'pane.exited'} in subscriptions


def test_runs_herdr(tmp_path):
    fake = tmp_path / 'herdr'
    fake.write_text('#!/bin/sh\n[ "$1" = fail ] && exit 1\n[ "$1" = text ] && echo hi && exit\n'
                    'echo "{\\"args\\": \\"$*\\"}"\n')
    fake.chmod(0o755)
    assert herdr('pane', 'list', command=fake) == {'args': 'pane list'}
    assert herdr('text', command=fake) == {}
    with pytest.raises(subprocess.CalledProcessError):
        herdr('fail', command=fake)


def test_reads_claude_transcripts(tmp_path):
    project = tmp_path / 'project' / '2026-a_b'
    found = claude.transcript_dir(project, tmp_path)
    assert found.parent == tmp_path / '.claude/projects'
    assert found.name.endswith('-project-2026-a-b')
    found.mkdir(parents=True)

    def transcript(name, mtime, *records):
        path = found / f'{name}.jsonl'
        path.write_text(''.join(json.dumps(r, separators=(',', ':')) + '\n' for r in records))
        os.utime(path, (mtime, mtime))
        return path

    renamed = transcript('renamed', 300,
                         {'type': 'last-prompt', 'lastPrompt': 'first\n  prompt'},
                         {'type': 'ai-title', 'aiTitle': 'Generated'},
                         {'type': 'custom-title', 'customTitle': 'Renamed'})
    generated = transcript('generated', 200, {'type': 'ai-title', 'aiTitle': 'Generated'})
    prompted = transcript('prompted', 100, {'type': 'last-prompt', 'lastPrompt': 'first\n  prompt'})
    empty = transcript('empty', 50)
    assert claude.transcripts(project, tmp_path) == [renamed, generated, prompted, empty]
    assert [claude.title(t) for t in (renamed, generated, prompted, empty)] == [
        'Renamed', 'Generated', 'first prompt', '']


def test_reads_front_matter(tmp_path):
    assert front_matter(tmp_path, 'title') is None
    (tmp_path / 'README.md').write_text('---\ntitle:  A title\nname: a\n---\nnames: b\n')
    assert front_matter(tmp_path, 'title') == 'A title'
    assert front_matter(tmp_path, 'name') == 'a'
    assert front_matter(tmp_path, 'names') == ''
    (tmp_path / 'README.md').write_text('# No front matter\ntitle: x\n')
    assert front_matter(tmp_path, 'title') == ''


def test_reads_titles_from_the_tail(tmp_path):
    def line(record):
        return json.dumps(record, separators=(',', ':')) + '\n'

    padding = line({'type': 'progress', 'text': 'x' * 100})
    titled = tmp_path / 'titled.jsonl'
    titled.write_text(line({'type': 'ai-title', 'aiTitle': 'Old'}) + padding * 3
                      + line({'type': 'ai-title', 'aiTitle': 'New'}))
    prompted = tmp_path / 'prompted.jsonl'
    prompted.write_text(line({'type': 'last-prompt', 'lastPrompt': 'first'}) + padding * 3)
    assert claude.title(titled, tail=200) == 'New'
    assert claude.title(prompted, tail=200) == 'first'

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from herdr_project import claude, screen, watch
from herdr_project.herdr import ancestors, herdr, in_pane
from herdr_project.match import clip, columns, spans, visible
from herdr_project.notes import front_matter, notes, report_title, reported_role
from herdr_project.remaining import fit, follow_remaining, forget_follower, remember_follower
from herdr_project.screen import Loading, follow


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


def test_fits_remaining_pane():
    def layout(top, ratio, direction='down'):
        return {'area': {'height': 60},
                'panes': [{'pane_id': top, 'rect': {'height': round(60 * ratio)}},
                          {'pane_id': 'agent', 'rect': {'height': 60 - round(60 * ratio)}}],
                'splits': [{'direction': direction, 'ratio': ratio}]}

    # A 21-row pane shows 19 rows inside its frame.
    assert fit(layout('r', 0.35), 'r', 4, 19) == ['--pane', 'r', '--direction', 'up',
                                                  '--amount', '0.2500']
    assert fit(layout('r', 0.25), 'r', 40, 13) == ['--pane', 'r', '--direction', 'down',
                                                   '--amount', '0.2500']
    assert fit(layout('r', 0.35), 'r', 1, 19)[-1] == '0.2500'
    assert fit(layout('r', 0.1), 'r', 4, 4) == []
    assert fit(layout('agent', 0.35), 'r', 4, 19) is None
    assert fit(layout('r', 0.35, 'right'), 'r', 4, 19) is None


@pytest.mark.skipif(shutil.which('zsh') is None, reason='zsh is not installed')
def test_remembers_follower_where_zshrc_looks(tmp_path):
    remember_follower('w1:p2', 'w1:p1', {'HOME': str(tmp_path)})
    found = subprocess.run(
        ['zsh', '-c', 'cat ${XDG_STATE_HOME:-$HOME/.local/state}/herdr-project/remaining/$HERDR_PANE_ID'],
        env={'HOME': str(tmp_path), 'HERDR_PANE_ID': 'w1:p2'},
        stdout=subprocess.PIPE, text=True, check=True).stdout
    assert found == 'w1:p1'


@pytest.mark.parametrize(('script', 'kept'), [
    ('echo \'{"error":{"code":"pane_not_found"}}\' >&2; exit 1', False),
    ('echo \'{"error":{"code":"server_not_running"}}\' >&2; exit 1', True),
    ('echo garbage >&2; exit 1', True),
    ('echo \'{"result":{"pane":{}}}\'', True),
])
def test_forgets_follower_only_when_its_pane_is_gone(tmp_path, script, kept):
    fake = tmp_path / 'herdr'
    fake.write_text(f'#!/bin/sh\n{script}\n')
    fake.chmod(0o755)
    env = {'HOME': str(tmp_path)}
    remember_follower('w1:p2', 'w1:p1', env)
    forget_follower('w1:p2', 'w1:p1',
                    lambda *args: herdr(*args, stderr=subprocess.PIPE, command=fake), env)
    assert (tmp_path / '.local/state/herdr-project/remaining/w1:p2').exists() == kept


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
    (tmp_path / 'README.md').write_text('---\ntitle:  A title \nname:\ta\n---\nnames: b\n')
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


def test_loads_rows_in_the_background():
    def lines():
        yield 'new\t\t\t+ new project'
        yield 'project\t/a\t\ta  A'
        raise OSError('gone')

    loading = Loading(lines())
    loading.wait()
    assert loading.rows == [['new', '', '', '+ new project'], ['project', '/a', '', 'a  A']]
    assert loading.done
    assert isinstance(loading.error, OSError)


def test_picker_refreshes_prompt_before_loading_rows(monkeypatch):
    class Terminal:
        def __init__(self):
            self.refreshed = False
            self.text = ''

        def getmaxyx(self):
            return 24, 80

        def erase(self):
            self.text = ''

        def addstr(self, y, x, text, attr):
            self.text += text

        def move(self, y, x):
            pass

        def refresh(self):
            assert self.text == 'project> '
            self.refreshed = True

    terminal = Terminal()

    def lines():
        assert terminal.refreshed
        yield 'new\t\t\t+ new project'

    def run(terminal, loading, notes, agents):
        loading.wait()
        assert loading.error is None
        return 0, agents[1]

    monkeypatch.setattr(screen.curses, 'wrapper', lambda start: start(terminal))
    monkeypatch.setattr(screen, 'run', run)
    assert screen.pick(lines(), lambda *args: '', ('claude', 'codex')) == (
        ['new', '', ''], 'codex')


def test_switches_agents_with_arrows_and_ctrl_keys():
    agents = ('claude', 'codex', 'other')
    assert screen.switch(agents, 'claude', screen.curses.KEY_RIGHT) == 'codex'
    assert screen.switch(agents, 'codex', '\x06') == 'other'
    assert screen.switch(agents, 'other', '\x06') == 'claude'
    assert screen.switch(agents, 'claude', '\x02') == 'other'
    assert screen.switch(agents, 'codex', screen.curses.KEY_LEFT) == 'claude'
    assert screen.switch(agents, 'codex', 'x') == 'codex'


def test_hints_name_the_selected_agent():
    assert screen.hint(['project', '/p', '', 'a'], 'codex') == (
        'enter: start a new codex session in this project')
    assert screen.hint(['new', '', '', '+ new project'], 'claude') == (
        'enter: start a new claude session in a new project')
    assert screen.hint(['session', '/p', 'claude:x', '  ● claude'], 'codex') == (
        'enter: switch to this running session')
    assert screen.hint(['session', '/p', '', '    you   Review'], 'codex') == (
        'enter: start a new codex session for this')


def test_picks_a_row_with_the_switched_agent(monkeypatch):
    class Terminal:
        """A terminal of 24 rows that is sent keys."""

        def __init__(self, keys):
            self.keys = list(keys)
            self.drawn = []

        def get_wch(self):
            return self.keys.pop(0)

        def getmaxyx(self):
            return 24, 80

        def addstr(self, y, x, text, attr=0):
            self.drawn.append((y, text, attr))

        def erase(self):
            self.drawn = []

        def move(self, y, x):
            pass

        def refresh(self):
            pass

        def timeout(self, delay):
            pass

    # Drawing needs a real terminal for its colors.
    monkeypatch.setattr(screen.curses, 'has_colors', lambda: False)
    loading = Loading(iter(['new\t\t\t+ new project', 'project\t/p\t\tp']))
    loading.wait()
    agents = ('claude', 'codex')
    keys = [screen.curses.KEY_RIGHT, screen.curses.KEY_DOWN, '\n']
    assert screen.run(Terminal(keys), loading, lambda *args: '', agents) == (1, 'codex')
    keys = ['\x06', '\x02', '\x02', '\n']
    assert screen.run(Terminal(keys), loading, lambda *args: '', agents) == (0, 'codex')
    terminal = Terminal([screen.curses.KEY_RIGHT, '\n'])
    assert screen.run(terminal, loading, lambda *args: '', agents) == (0, 'codex')
    # The new project row shows the agents, the selected one reversed.
    row = [(text, attr) for y, text, attr in terminal.drawn if y == 1]
    assert ''.join(text for text, _ in row).endswith('+ new project with  claude  codex ')
    assert [text for text, attr in row if attr & screen.curses.A_REVERSE] == [' codex ']


def test_cursor_follows_its_row_as_rows_arrive():
    assert follow([0, 2], 1, [0, 1, 2]) == 2
    assert follow([0, 2], 1, [0, 1]) == 1
    assert follow([], 0, [0]) == 0


def test_reports_title(tmp_path):
    calls = []
    report_title('w', tmp_path, lambda *args: calls.append(args))
    (tmp_path / 'README.md').write_text('---\ntitle: A title\n---\n')
    report_title('w', tmp_path, lambda *args: calls.append(args))
    assert calls == [('workspace', 'report-metadata', 'w', '--source', 'readme-title',
                      '--token', 'title=A title')]


def test_in_pane_skips_background_sessions():
    env = {'HERDR_ENV': '1', 'HERDR_PANE_ID': 'p'}
    assert in_pane(env, ['claude', 'zsh'])
    assert not in_pane(env, ['claude', 'claude --bg-pty-host 3'])
    assert not in_pane({'HERDR_PANE_ID': 'p'}, [])
    assert not in_pane({'HERDR_ENV': '1'}, [])


def test_ancestors_walks_up_from_pid():
    with subprocess.Popen(['sleep', '10']) as child:
        try:
            found = ancestors(child.pid)
            assert next(found) == 'sleep 10'
            assert 'pytest' in next(found)
        finally:
            child.kill()


def test_starts_the_watcher_once(tmp_path):
    env = {'HOME': str(tmp_path)}
    panes = set()
    workspaces = [{'label': '~'}]
    calls = []

    def fake_herdr(*args):
        calls.append(args)
        if args == ('workspace', 'list'):
            return {'result': {'workspaces': workspaces}}
        if args[:2] == ('pane', 'get'):
            if args[2] == 'w8:p1':
                raise subprocess.CalledProcessError(1, ['herdr', *args], output='')
            if args[2] == 'w7:p1':
                raise subprocess.CalledProcessError(
                    1, ['herdr', *args], output='', stderr='{"error":{"code":"pane_not_found"}}')
            if args[2] not in panes:
                raise subprocess.CalledProcessError(
                    1, ['herdr', *args], output='{"error":{"code":"pane_not_found"}}')
            return {'result': {'pane': {'pane_id': args[2]}}}
        panes.add('w2:p1')
        return {'result': {'root_pane': {'pane_id': 'w2:p1'}}}

    watch.remember_watcher('w9:p1', ['gone'], env)
    watch.remember_watcher('w7:p1', [], env)  # Herdr says so on stderr.
    assert watch.start(fake_herdr, env)
    assert not watch.watcher_file('w9:p1', env).exists()
    assert not watch.watcher_file('w7:p1', env).exists()
    assert calls[-1] == ('workspace', 'create', '--label', 'watch', '--cwd', str(tmp_path),
                         '--env', 'HERDR_PROJECT_WATCH=1', '--no-focus')
    assert not watch.start(fake_herdr, env)

    # A restored workspace counts before its pane is back.
    watch.watcher_file('w2:p1', env).unlink()
    workspaces.append({'label': 'watch'})
    assert not watch.start(fake_herdr, env)

    # Without a workspace, a failure that isn't pane_not_found keeps the record.
    workspaces.pop()
    watch.remember_watcher('w8:p1', [], env)
    with pytest.raises(subprocess.CalledProcessError):
        watch.start(fake_herdr, env)
    assert watch.watcher_file('w8:p1', env).exists()
    assert [c[:2] for c in calls].count(('workspace', 'create')) == 1


@pytest.mark.skipif(shutil.which('zsh') is None, reason='zsh is not installed')
def test_remembers_watcher_where_zshrc_looks(tmp_path):
    watch.remember_watcher('w1:p2', ['org one', 'two'], {'HOME': str(tmp_path)})
    found = subprocess.run(
        ['zsh', '-c', 'print -rl -- ${(f)"$(cat ${XDG_STATE_HOME:-$HOME/.local/state}/herdr-project/watcher/$HERDR_PANE_ID)"}'],
        env={'HOME': str(tmp_path), 'HERDR_PANE_ID': 'w1:p2'},
        stdout=subprocess.PIPE, text=True, check=True).stdout
    assert found == 'org one\ntwo\n'


def test_runs_the_web_page_only_once_installed(tmp_path):
    assert watch.web_command(tmp_path, 'v24.8.0\n') is None
    (tmp_path / 'node_modules').mkdir()
    assert watch.web_command(tmp_path, 'v22.5.1\n') is None
    assert watch.web_command(tmp_path, 'junk') is None
    command = watch.web_command(tmp_path, 'v22.6.0\n')
    assert command[-1] == str(tmp_path / 'main.ts')
    assert f"--watch-path={tmp_path / 'restart.stamp'}" in command
    assert (tmp_path / 'restart.stamp').exists()


def test_tells_the_web_page_what_to_watch():
    env = watch.web_env({'HOME': '/h'}, ['org'], '/dev/ttys001')
    assert env == {'HOME': '/h', 'HERDR_PROJECT_ORGS': '["org"]', 'HERDR_PROJECT_TTY': '/dev/ttys001'}
    assert watch.web_env({}, (), None) == {'HERDR_PROJECT_ORGS': '[]'}


def test_runs_the_web_page_with_its_output_in_a_log(tmp_path):
    log = tmp_path / 'state/web.log'
    with pytest.raises(OSError):
        watch.run_web([str(tmp_path / 'missing')], [], log, {})
    script = "import os, sys; print(os.environ['HERDR_PROJECT_ORGS']); sys.exit(3)"
    assert watch.run_web([sys.executable, '-c', script], ['org'], log, {}) == 3
    assert log.read_text() == '["org"]\n'


# run_web as the watcher runs it, in a process of its own, since the test
# signals it: python -c RUN_WEB <repo> <log> <script>, under node's watch
# mode.
RUN_WEB = """
import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from herdr_project import watch
command = ["node", f"--watch-path={sys.argv[3]}", sys.argv[3]]
print(watch.run_web(command, [], Path(sys.argv[2]), dict(os.environ)), flush=True)
"""


@pytest.mark.skipif(shutil.which('node') is None, reason='node is not installed')
@pytest.mark.parametrize('sig', [signal.SIGTERM, signal.SIGHUP])
def test_ends_the_web_page_on_signals(tmp_path, sig):
    log = tmp_path / 'web.log'
    script = tmp_path / 'page.js'
    # Like the page, it runs until killed, under node's watch mode.
    script.write_text('console.log(`pid ${process.pid}`); setInterval(() => {}, 1000);\n')
    watcher = subprocess.Popen([sys.executable, '-c', RUN_WEB, str(Path(__file__).parent.parent),
                                str(log), str(script)], stdout=subprocess.PIPE, text=True)
    deadline = time.monotonic() + 10
    while 'pid ' not in (log.read_text() if log.exists() else '') and time.monotonic() < deadline:
        time.sleep(0.05)
    page = int(log.read_text().split('pid ')[1].split()[0])
    watcher.send_signal(sig)
    out, _ = watcher.communicate(timeout=10)
    assert out == 'None\n'
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            os.kill(page, 0)
        except ProcessLookupError:
            break
        time.sleep(0.05)
    else:
        os.kill(page, signal.SIGKILL)
        pytest.fail('the page outlived the watcher')



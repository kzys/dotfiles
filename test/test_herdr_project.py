import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from herdr_project import claude, pull_request, watch
from herdr_project.herdr import ancestors, herdr, in_pane
from herdr_project.inbox import Owner
from herdr_project.match import clip, columns, spans, visible
from herdr_project.notes import front_matter, notes, report_title, reported_role
from herdr_project.remaining import fit, follow_remaining, forget_follower, remember_follower
from herdr_project.screen import Loading, follow
from herdr_project.state import load_state, save_state


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


def pr_node(number, branch, state='OPEN', checks=None, failed=(), review=None,
            repo='org/app', head=None):
    contexts = [{'__typename': 'CheckRun', 'name': n, 'conclusion': 'FAILURE'} for n in failed]
    contexts.append({'__typename': 'StatusContext', 'context': 'ok', 'state': 'SUCCESS'})
    rollup = {'state': checks, 'contexts': {'nodes': contexts}} if checks else None
    return {'number': number, 'title': f'PR {number}',
            'url': f'https://github.com/{repo}/pull/{number}', 'state': state,
            'isDraft': False, 'headRefName': branch, 'reviewDecision': review,
            'repository': {'nameWithOwner': repo},
            'headRepository': {'nameWithOwner': head or repo},
            'commits': {'nodes': [{'commit': {'statusCheckRollup': rollup}}]}}


def search(*nodes):
    return {'data': {'search': {'nodes': list(nodes)}}}


def test_reads_pull_requests():
    prs = pull_request.pull_requests(search(
        pr_node(1, 'a', checks='FAILURE', failed=['test', 'lint']), pr_node(2, 'b'), {}))
    assert [(p['number'], p['checks'], p['failed']) for p in prs] == [
        (1, 'FAILURE', ['lint', 'test']), (2, None, [])]
    assert prs[0]['repo'] == 'org/app'
    assert prs[0]['branch'] == 'a'
    assert [(r['name'], r['state']) for r in prs[0]['runs']] == [
        ('lint', 'failed'), ('ok', 'passed'), ('test', 'failed')]


def test_reads_how_each_check_went():
    assert pull_request.runs([
        {'__typename': 'CheckRun', 'name': 'build', 'conclusion': None,
         'detailsUrl': 'https://ci/1'},
        {'__typename': 'CheckRun', 'name': 'docs', 'conclusion': 'SKIPPED'},
        {'__typename': 'StatusContext', 'context': 'deploy', 'state': 'PENDING',
         'targetUrl': 'https://ci/2'},
        {'__typename': 'CheckRun', 'name': 'e2e', 'conclusion': 'TIMED_OUT'},
        {'__typename': 'CheckRun', 'name': 'old', 'conclusion': 'CANCELLED'},
    ]) == [
        {'name': 'build', 'state': 'running', 'url': 'https://ci/1'},
        {'name': 'deploy', 'state': 'running', 'url': 'https://ci/2'},
        {'name': 'docs', 'state': 'skipped', 'url': None},
        {'name': 'e2e', 'state': 'failed', 'url': None},
        {'name': 'old', 'state': 'cancelled', 'url': None}]


def test_reads_repo_names():
    assert pull_request.repo_name('git@github.com:org/app.git') == 'org/app'
    assert pull_request.repo_name('https://github.com/org/app') == 'org/app'
    assert pull_request.repo_name('https://github.com/org/app.git\n') == 'org/app'
    assert pull_request.repo_name('ssh://git@github.com/org/app.git') == 'org/app'
    assert pull_request.repo_name('git@gitlab.com:org/app.git') is None


def git_checkout(path, branch, remote='git@github.com:org/app.git'):
    path.mkdir(parents=True)
    run = lambda *args: subprocess.run(['git', '-C', str(path), *args], check=True,
                                       stdout=subprocess.DEVNULL)
    run('init', '-q', '-b', branch)
    run('remote', 'add', 'origin', remote)


def test_finds_agents_in_checkouts_of_pull_requests(tmp_path):
    git_checkout(tmp_path / 'repos/org/app', 'me/one')
    (tmp_path / 'repos/org/app/sub').mkdir()
    git_checkout(tmp_path / 'repos/org/other', 'me/one', 'git@github.com:org/other.git')
    git_checkout(tmp_path / 'repos/me/app', 'main', 'git@github.com:me/app.git')
    prs = pull_request.pull_requests(search(
        pr_node(1, 'me/one'), pr_node(2, 'me/two'),
        # From a fork's main, which the upstream's main isn't.
        pr_node(3, 'main', head='me/app')))
    panes = [
        {'pane_id': 'w1:p1', 'agent': None, 'cwd': str(tmp_path / 'repos/org/app')},
        {'pane_id': 'w1:p2', 'agent': 'claude', 'cwd': str(tmp_path / 'repos/org/other')},
        {'pane_id': 'w1:p3', 'agent': 'claude', 'cwd': str(tmp_path / 'repos/org/app/sub')},
        {'pane_id': 'w1:p4', 'agent': 'codex', 'cwd': str(tmp_path / 'repos/org/app')},
        {'pane_id': 'w1:p5', 'agent': 'claude', 'cwd': str(tmp_path / 'gone')},
        {'pane_id': 'w1:p6', 'agent': 'claude', 'cwd': str(tmp_path / 'repos/me/app')},
    ]
    found = pull_request.checkout_panes(panes, prs)
    assert {url: p['pane_id'] for url, p in found.items()} == {
        'https://github.com/org/app/pull/1': 'w1:p3',
        'https://github.com/org/app/pull/3': 'w1:p6'}


def test_wakes_the_agent_in_the_checkout_over_one_in_the_project(tmp_path):
    # Only GitHub is replaced; git, the notes and the state file are real.
    (tmp_path / 'project/20261001-a').mkdir(parents=True)
    (tmp_path / 'project/20261001-a/AGENT-main.md').write_text('- watch app#1\n')
    git_checkout(tmp_path / 'repos/org/app', 'me/one')
    responses = tmp_path / 'responses'
    responses.mkdir()
    gh = tmp_path / 'gh'
    gh.write_text(f'#!/bin/sh\nf=$(ls {responses} | head -1)\ncat {responses}/$f\n'
                  f'[ $(ls {responses} | wc -l) -gt 1 ] && rm {responses}/$f\nexit 0\n')
    gh.chmod(0o755)
    (responses / '1').write_text(json.dumps(search(pr_node(1, 'me/one', checks='PENDING'))))
    (responses / '2').write_text(json.dumps(search(pr_node(1, 'me/one', checks='FAILURE'))))
    calls = []

    def fake_herdr(*args):
        calls.append(args)
        if args[:2] == ('pane', 'list'):
            return {'result': {'panes': [
                {'pane_id': 'w1:p1', 'agent': 'claude', 'agent_status': 'idle',
                 'cwd': str(tmp_path / 'project/20261001-a'), 'tokens': {}},
                {'pane_id': 'w2:p1', 'agent': 'claude', 'agent_status': 'idle',
                 'cwd': str(tmp_path / 'repos/org/app'), 'tokens': {}}]}}
        return {}

    state = tmp_path / 'state/pull-requests.json'
    _, _, _, rows = pull_request.poll(fake_herdr, tmp_path / 'project', state, gh=str(gh))
    assert [(r['project'], r['agent'], r['pane']) for r in rows] == [('20261001-a', True, 'w2:p1')]
    pull_request.poll(fake_herdr, tmp_path / 'project', state, gh=str(gh))
    assert [c[2] for c in calls if c[:2] == ('pane', 'run')] == ['w2:p1']


def test_finds_projects_of_pull_requests(tmp_path):
    git_checkout(tmp_path / '20261001-a/app', 'me/one')
    git_checkout(tmp_path / '20261001-a/other', 'me/two', 'git@github.com:org/other.git')
    (tmp_path / '20261002-b').mkdir()
    (tmp_path / '20261002-b/AGENT-prs.md').write_text('- app#3 and app#40 wait for review\n')
    (tmp_path / '20261002-b/README.md').write_text('app#3\n')
    (tmp_path / '20261003-c').mkdir()
    (tmp_path / '20261003-c/AGENT-main.md').write_text('https://github.com/org/app/pull/5 done\n')
    trees = pull_request.worktrees(tmp_path)
    texts = pull_request.notes_texts(tmp_path)
    prs = {p['number']: p for p in pull_request.pull_requests(search(
        pr_node(1, 'me/one'), pr_node(2, 'me/two'), pr_node(3, 'x'), pr_node(4, 'y'),
        pr_node(5, 'z')))}

    def found(n):
        return pull_request.owner(prs[n], trees, texts)

    assert found(1) == Owner(str(tmp_path / '20261001-a'), str(tmp_path / '20261001-a/app'))
    # The checkout on me/two is of another repository.
    assert found(2) is None
    assert found(3) == Owner(str(tmp_path / '20261002-b'), role='prs')
    assert found(4) is None
    assert found(5).project == str(tmp_path / '20261003-c')


def test_finds_agent_panes():
    def pane(id, cwd, role=None, agent='claude'):
        return {'pane_id': id, 'agent': agent, 'cwd': '/p/a',
                'tokens': {'cwd': cwd, **({'role': role} if role else {})}}

    panes = [pane('shell', '/p/a/app', agent=None), pane('main', '/p/a', 'main'),
             pane('prs', '/p/a', 'prs'), pane('app', '/p/a/app/sub'), pane('b', '/p/ab')]
    find = lambda **f: (pull_request.agent_pane(panes, Owner(**{'project': '/p/a', **f}))
                        or {}).get('pane_id')
    assert find(dir='/p/a/app') == 'app'
    assert find(role='prs') == 'prs'
    assert find(role='gone') == 'main'
    assert find(project='/p/c') is None


def test_reports_pull_request_changes():
    def prs(*nodes):
        return pull_request.pull_requests(search(*nodes))

    before = prs(pr_node(1, 'a', checks='PENDING'), pr_node(2, 'b', checks='PENDING'),
                 pr_node(3, 'c', checks='SUCCESS'), pr_node(4, 'd', checks='FAILURE'))
    assert pull_request.events(None, before) == []
    old = pull_request.remember(None, before)
    after = prs(pr_node(1, 'a', checks='FAILURE', failed=['test']),
                pr_node(2, 'b', checks='SUCCESS', review='APPROVED'),
                pr_node(3, 'c', state='MERGED', checks='SUCCESS'),
                pr_node(4, 'd', checks='FAILURE'),
                pr_node(5, 'e', checks='FAILURE', failed=['lint']),
                pr_node(6, 'f', checks='PENDING'))
    assert [(p['number'], m, w) for p, m, w in pull_request.events(old, after)] == [
        (1, 'checks failed: test', True), (2, 'checks passed', False),
        (2, 'approved', False), (3, 'merged', False), (5, 'checks failed: lint', True)]
    assert sorted(pull_request.remember(old, after)) == [
        f'https://github.com/org/app/pull/{n}' for n in (1, 2, 4, 5, 6)]


def test_polls_pull_requests(tmp_path):
    # Only GitHub is replaced; git, the notes and the state file are real.
    git_checkout(tmp_path / 'project/20261001-a/app', 'me/one')
    (tmp_path / 'project/20261001-a/README.md').write_text('---\nname: one\n---\n')
    responses = tmp_path / 'responses'
    responses.mkdir()
    gh = tmp_path / 'gh'
    gh.write_text(f'#!/bin/sh\nf=$(ls {responses} | head -1)\ncat {responses}/$f\n'
                  f'[ $(ls {responses} | wc -l) -gt 1 ] && rm {responses}/$f\nexit 0\n')
    gh.chmod(0o755)
    (responses / '1').write_text(json.dumps(search(pr_node(1, 'me/one', checks='PENDING'))))
    (responses / '2').write_text(json.dumps(search(
        pr_node(1, 'me/one', checks='FAILURE', failed=['test']))))
    calls = []
    status = ['idle']

    def fake_herdr(*args):
        calls.append(args)
        if args[:2] == ('pane', 'list'):
            return {'result': {'panes': [
                {'pane_id': 'w1:p1', 'agent': 'claude', 'agent_status': status[0],
                 'cwd': str(tmp_path / 'project/20261001-a'), 'tokens': {}}]}}
        return {}

    state = tmp_path / 'state/pull-requests.json'
    lines, owners, items, rows = pull_request.poll(
        fake_herdr, tmp_path / 'project', state, gh=str(gh))
    assert items == []
    # The agent is in the project but not the checkout, so may be busy
    # with something else.
    assert [(r['label'], r['project'], r['agent'], r['pane'], r['checks']) for r in rows] == [
        ('app#1', 'one', True, None, 'PENDING')]
    assert owners['https://github.com/org/app/pull/1'].project == str(
        tmp_path / 'project/20261001-a')
    assert lines == [f'… ● {"app#1":<24} {"one":<20} PR 1']
    assert calls == [('pane', 'list')]
    calls.clear()
    lines, _, items, _ = pull_request.poll(fake_herdr, tmp_path / 'project', state, gh=str(gh))
    assert items == [{'project': str(tmp_path / 'project/20261001-a'), 'role': None,
                      'mark': 'pr', 'text': 'app#1 checks failed: test: PR 1'}]
    assert lines[0].startswith('✗ ● app#1')
    url = 'https://github.com/org/app/pull/1'
    assert calls[1:] == [
        ('notification', 'show', 'app#1 checks failed: test', '--body', 'PR 1 (20261001-a)',
         '--sound', 'request'),
        ('pane', 'run', 'w1:p1', pull_request.wake_message(
            pull_request.pull_requests(search(pr_node(1, 'me/one')))[0],
            'checks failed: test'))]
    assert json.loads(state.read_text())[url]['checks'] == 'FAILURE'


def test_shows_why_gh_failed(tmp_path):
    gh = tmp_path / 'gh'
    gh.write_text('#!/bin/sh\necho "HTTP 502: Bad Gateway" >&2\nexit 1\n')
    gh.chmod(0o755)
    with pytest.raises(RuntimeError, match='^HTTP 502: Bad Gateway$'):
        pull_request.fetch(str(gh))


def test_searches_pull_requests_in_orgs():
    since = datetime(2026, 10, 2, tzinfo=UTC)
    assert pull_request.search_query(since) == (
        'is:pr author:@me archived:false updated:>=2026-10-02 sort:updated-desc')
    assert pull_request.search_query(since, ['a', 'b']) == (
        'is:pr author:@me archived:false org:a org:b updated:>=2026-10-02 sort:updated-desc')
    assert pull_request.search_query(since, ['a'], only_open=True) == (
        'is:pr author:@me archived:false is:open org:a updated:>=2026-10-02 sort:updated-desc')


def test_reads_open_pull_requests_beyond_the_recent_ones():
    data = search(pr_node(2, 'me/one', state='MERGED'), pr_node(1, 'me/one'))
    data['data']['open'] = {'nodes': [pr_node(1, 'me/one'), pr_node(3, 'me/two')]}
    assert [(pr['number'], pr['state']) for pr in pull_request.pull_requests(data)] == [
        (1, 'OPEN'), (3, 'OPEN'), (2, 'MERGED')]


def test_draws_watch_screen():
    at = datetime(2026, 10, 16, 15, 4, tzinfo=UTC)
    assert watch.screen([('PRs', at, ['a', 'b']), ('Slack', None, ['c'])]) == (
        'PRs at 15:04\na\nb\n\nSlack\nc')
    assert watch.screen([('PRs', at, ['a']), ('Slack', None, None)]) == 'PRs at 15:04\na'


def test_keeps_watch_screen_for_other_viewers():
    at = datetime(2026, 10, 16, 15, 4, tzinfo=UTC)
    assert watch.screen_state([('PRs', at, ['a'], [{'label': 'app#1'}]), ('Slack', None, None),
                               ('Panes', None, []), ('Failed', at, ['x'], None)],
                              {'PRs': at + timedelta(minutes=5)}) == [
        {'title': 'PRs', 'at': '2026-10-16T15:04:00+00:00', 'next': '2026-10-16T15:09:00+00:00',
         'lines': ['a'], 'pullRequests': [{'label': 'app#1'}]},
        {'title': 'Panes', 'at': None, 'next': None, 'lines': []},
        {'title': 'Failed', 'at': '2026-10-16T15:04:00+00:00', 'next': None, 'lines': ['x']}]


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


def test_passes_the_poller_to_the_web_page():
    env = watch.web_env({'HOME': '/h'}, ['herdr-project', '--poll', 'org'], '/dev/ttys001')
    assert env == {'HOME': '/h', 'HERDR_PROJECT_POLLER': '["herdr-project", "--poll", "org"]',
                   'HERDR_PROJECT_TTY': '/dev/ttys001'}
    assert 'HERDR_PROJECT_TTY' not in watch.web_env({}, [], None)


# exec_web replaces the process that calls it, so it runs in one of its own:
# python -c BECOME <repo> <missing command> <log>.
BECOME = """
import os, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from herdr_project import watch
try:
    watch.exec_web([sys.argv[2]], [], Path(sys.argv[3]), {})
except OSError:
    print("still here", flush=True)
watch.exec_web([sys.executable, "-c", "import os; print(os.environ['HERDR_PROJECT_POLLER'])"],
               ["p", "--poll"], Path(sys.argv[3]), {})
"""


def test_becomes_the_web_page_with_its_output_in_a_log(tmp_path):
    log = tmp_path / 'state/web.log'
    out = subprocess.run([sys.executable, '-c', BECOME, str(Path(__file__).parent.parent),
                          str(tmp_path / 'missing'), str(log)],
                         stdout=subprocess.PIPE, text=True, check=True).stdout
    # Failing to exec leaves the output where it was.
    assert out == 'still here\n'
    assert log.read_text() == '["p", "--poll"]\n'


def test_reports_errored_and_unnamed_checks():
    node = pr_node(1, 'a', checks='PENDING')
    old = pull_request.remember(None, pull_request.pull_requests(search(node)))
    node = pr_node(1, 'a', checks='ERROR')
    node['commits']['nodes'][0]['commit']['statusCheckRollup']['contexts']['nodes'].append(
        {'__typename': 'StatusContext', 'state': 'ERROR'})
    [(_, message, wake)] = pull_request.events(old, pull_request.pull_requests(search(node)))
    assert (message, wake) == ('checks failed: ?', True)


def test_needs_the_pull_requests_repo_in_the_worktree():
    pr = pull_request.pull_requests(search(pr_node(1, 'me/one', repo='Org/App')))[0]
    def tree(repo):
        return [{'project': '/p/a', 'dir': '/p/a/app', 'branch': 'me/one', 'repo': repo}]
    assert pull_request.owner(pr, tree('org/app'), []).dir == '/p/a/app'
    assert pull_request.owner(pr, tree(None), []) is None


def test_keeps_state(tmp_path):
    path = tmp_path / 'state/x.json'
    assert load_state(path) is None
    save_state(path, {'a': [1]})
    assert load_state(path) == {'a': [1]}
    assert [p.name for p in path.parent.iterdir()] == ['x.json']
    path.write_text('{"a": ')
    assert load_state(path) is None


def test_reports_to_the_web_page():
    assert watch.reporter({}) is None
    read, write = os.pipe()
    env = {'HERDR_PROJECT_REPORT_FD': str(write), 'HOME': '/h'}
    report = watch.reporter(env)
    # Children don't learn of the pipe.
    assert env == {'HOME': '/h'}
    report([{'title': 'PRs', 'at': None, 'next': None, 'lines': ['a']}], {'PRs': [{'text': '1'}]},
           {'https://github.com/o/r/pull/1': Owner('/p/a', role='main'), 'https://x/2': None})
    del report  # Closes the pipe's end.
    with os.fdopen(read) as lines:
        assert json.loads(lines.readline()) == {
            'sections': [{'title': 'PRs', 'at': None, 'next': None, 'lines': ['a']}],
            'inbox': {'PRs': [{'text': '1'}]},
            'owners': {'https://github.com/o/r/pull/1': {'project': '/p/a', 'dir': None, 'role': 'main'},
                       'https://x/2': None}}


def test_lists_pull_requests_waiting_on_me():
    prs = pull_request.pull_requests(search(
        pr_node(1, 'a', checks='FAILURE', failed=['test']),
        pr_node(2, 'b', checks='SUCCESS', review='CHANGES_REQUESTED'),
        pr_node(3, 'c', checks='SUCCESS', review='APPROVED'),
        pr_node(4, 'd', checks='PENDING', review='APPROVED'),
        pr_node(5, 'e', state='MERGED', checks='FAILURE'),
        pr_node(6, 'f', checks='SUCCESS')))
    owners = {prs[0]['url']: Owner('/p/a', '/p/a/app')}
    assert [(i['project'], i['text']) for i in pull_request.waiting_items(prs, owners)] == [
        ('/p/a', 'app#1 checks failed: test: PR 1'),
        (None, 'app#2 changes requested: PR 2'),
        (None, 'app#3 approved, ready to merge: PR 3')]



import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from herdr_project import claude, headless, inbox, linear, pull_request, slack, watch
from herdr_project.herdr import ancestors, herdr, in_pane
from herdr_project.match import clip, columns, spans, visible
from herdr_project.notes import front_matter, notes, report_title, reported_role
from herdr_project.remaining import follow_remaining, remember_follower
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


@pytest.mark.skipif(shutil.which('zsh') is None, reason='zsh is not installed')
def test_remembers_follower_where_zshrc_looks(tmp_path):
    remember_follower('w1:p2', 'w1:p1', {'HOME': str(tmp_path)})
    found = subprocess.run(
        ['zsh', '-c', 'cat ${XDG_STATE_HOME:-$HOME/.local/state}/herdr-project/remaining/$HERDR_PANE_ID'],
        env={'HOME': str(tmp_path), 'HERDR_PANE_ID': 'w1:p2'},
        stdout=subprocess.PIPE, text=True, check=True).stdout
    assert found == 'w1:p1'


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
            repo='org/app'):
    contexts = [{'__typename': 'CheckRun', 'name': n, 'conclusion': 'FAILURE'} for n in failed]
    contexts.append({'__typename': 'StatusContext', 'context': 'ok', 'state': 'SUCCESS'})
    rollup = {'state': checks, 'contexts': {'nodes': contexts}} if checks else None
    return {'number': number, 'title': f'PR {number}',
            'url': f'https://github.com/{repo}/pull/{number}', 'state': state,
            'isDraft': False, 'headRefName': branch, 'reviewDecision': review,
            'repository': {'nameWithOwner': repo},
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

    assert found(1) == {'project': str(tmp_path / '20261001-a'),
                        'dir': str(tmp_path / '20261001-a/app'), 'role': None}
    # The checkout on me/two is of another repository.
    assert found(2) is None
    assert found(3) == {'project': str(tmp_path / '20261002-b'), 'dir': None, 'role': 'prs'}
    assert found(4) is None
    assert found(5)['project'] == str(tmp_path / '20261003-c')


def test_finds_agent_panes():
    def pane(id, cwd, role=None, agent='claude'):
        return {'pane_id': id, 'agent': agent, 'cwd': '/p/a',
                'tokens': {'cwd': cwd, **({'role': role} if role else {})}}

    panes = [pane('shell', '/p/a/app', agent=None), pane('main', '/p/a', 'main'),
             pane('prs', '/p/a', 'prs'), pane('app', '/p/a/app/sub'), pane('b', '/p/ab')]
    find = lambda **f: (pull_request.agent_pane(panes, {'project': '/p/a', 'dir': None,
                                                       'role': None, **f}) or {}).get('pane_id')
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
    lines, owners, items = pull_request.poll(fake_herdr, tmp_path / 'project', state, gh=str(gh))
    assert items == []
    assert owners['https://github.com/org/app/pull/1']['project'] == str(
        tmp_path / 'project/20261001-a')
    assert lines == [f'… ● {"app#1":<24} {"one":<20} PR 1']
    assert calls == [('pane', 'list')]
    calls.clear()
    lines, _, items = pull_request.poll(fake_herdr, tmp_path / 'project', state, gh=str(gh))
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


def test_searches_pull_requests_in_orgs():
    since = datetime(2026, 10, 2, tzinfo=UTC)
    assert pull_request.search_query(since) == (
        'is:pr author:@me archived:false updated:>=2026-10-02 sort:updated-desc')
    assert pull_request.search_query(since, ['a', 'b']) == (
        'is:pr author:@me archived:false org:a org:b updated:>=2026-10-02 sort:updated-desc')


def conversation(channel_id, thread_ts, last_ts, waiting=False, links=()):
    return {'channel_id': channel_id, 'thread_ts': thread_ts, 'channel': f'#{channel_id}',
            'summary': f'about {thread_ts}', 'waiting_on_me': waiting, 'last_ts': last_ts,
            'links': list(links)}


def test_reads_structured_output():
    found = [conversation('C1', '1.5', '2.0')]
    assert headless.structured({'structured_output': {'conversations': found}},
                               'conversations') == found
    with pytest.raises(ValueError, match='denied'):
        headless.structured({'is_error': True, 'result': 'denied'}, 'conversations')
    with pytest.raises(ValueError):
        headless.structured({'result': 'no schema'}, 'conversations')


def test_finds_projects_of_slack_conversations():
    texts = [('/p/a', 'main', 'Slack thread C1 p1700000000123456 asks for review'),
             ('/p/b', None, 'see C2 for context'),
             ('/p/c', 'dm', 'DM in D9 about the rollout')]
    pr_owners = {'https://github.com/o/r/pull/1': {'project': '/p/x', 'dir': None, 'role': None}}

    def find(c):
        return (slack.owner(c, texts, pr_owners) or {}).get('project')

    assert find(conversation('C1', '1700000000123456.000000', '0')) is None
    assert find(conversation('C1', '1700000000.123456', '0')) == '/p/a'
    assert find(conversation('D9', '', '0')) == '/p/c'
    assert find(conversation('C2', '17.5', '0', links=['https://github.com/o/r/pull/1'])) == '/p/x'
    assert find(conversation('C3', '18.5', '0')) is None


def test_reports_slack_conversations_waiting_on_me():
    before = [conversation('C1', '1.0', '100', waiting=True), conversation('C2', '2.0', '100')]
    assert slack.events(None, before) == []
    old = slack.remember(None, before, now=200)
    after = [conversation('C1', '1.0', '100', waiting=True),
             conversation('C2', '2.0', '150', waiting=True),
             conversation('C3', '3.0', '160', waiting=True),
             conversation('C4', '4.0', '170')]
    assert [c['channel_id'] for c in slack.events(old, after)] == ['C2', 'C3']
    assert slack.remember(old, after, now=100 + 7 * 86400 + 10) == {
        'C2/2.0': '150.000000', 'C3/3.0': '160.000000', 'C4/4.0': '170.000000'}


def test_polls_slack(tmp_path):
    (tmp_path / 'a').mkdir()
    (tmp_path / 'a/README.md').write_text('---\nname: alpha\n---\n')
    texts = [(str(tmp_path / 'a'), None, 'thread C1 p15')]
    runs = [[conversation('C1', '1.5', '10')],
            [conversation('C1', '1.5', '20', waiting=True), conversation('C2', '', '5')]]
    calls = []
    state = tmp_path / 'state/slack.json'

    def fake_herdr(*args):
        calls.append(args)
        return {}

    assert slack.poll(fake_herdr, texts, state, {}, fetch=lambda d: runs.pop(0))[0] == [
        f'  {"#C1":<26} {"alpha":<20} about 1.5']
    assert calls == []
    lines, items = slack.poll(fake_herdr, texts, state, {}, fetch=lambda d: runs.pop(0))
    assert items == [{'project': str(tmp_path / 'a'), 'role': None, 'mark': 'slack',
                      'text': 'Slack #C1: about 1.5'}]
    assert lines[0] == f'* {"#C1":<26} {"alpha":<20} about 1.5'
    assert calls == [('notification', 'show', 'Slack #C1', '--body', 'about 1.5 (a)',
                      '--sound', 'request')]


def test_draws_watch_screen():
    at = datetime(2026, 10, 16, 15, 4, tzinfo=UTC)
    assert watch.screen([('PRs', at, ['a', 'b']), ('Slack', None, ['c'])]) == (
        'PRs at 15:04\na\nb\n\nSlack\nc')


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
            if args[2] not in panes:
                raise subprocess.CalledProcessError(
                    1, ['herdr', *args], output='{"error":{"code":"pane_not_found"}}')
            return {'result': {'pane': {'pane_id': args[2]}}}
        panes.add('w2:p1')
        return {'result': {'root_pane': {'pane_id': 'w2:p1'}}}

    watch.remember_watcher('w9:p1', ['gone'], env)
    assert watch.start(fake_herdr, env)
    assert not watch.watcher_file('w9:p1', env).exists()
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


def issue(identifier, updated_at, waiting=False, links=(), state='Backlog'):
    return {'identifier': identifier, 'title': f'Title {identifier}', 'state': state,
            'url': f'https://linear.app/x/issue/{identifier}', 'updated_at': updated_at,
            'summary': f'about {identifier}', 'waiting_on_me': waiting, 'links': list(links)}


def test_finds_projects_of_linear_issues():
    texts = [('/p/a', 'main', 'tracks ABC-123 and ABC-12'), ('/p/b', None, 'XABC-7 XYZ-45')]
    pr_owners = {'https://github.com/o/r/pull/1': {'project': '/p/x', 'dir': None, 'role': None}}

    def find(i):
        return (linear.owner(i, texts, pr_owners) or {}).get('project')

    assert find(issue('ABC-123', '')) == '/p/a'
    assert find(issue('ABC-1', '')) is None
    assert find(issue('ABC-7', '')) is None
    assert find(issue('XYZ-45', '')) == '/p/b'
    assert find(issue('ABC-9', '', links=['https://github.com/o/r/pull/1'])) == '/p/x'


def test_polls_linear(tmp_path):
    (tmp_path / 'a').mkdir()
    texts = [(str(tmp_path / 'a'), 'main', 'ABC-2')]
    runs = [[issue('ABC-1', '2026-10-15T00:00Z', waiting=True), issue('ABC-2', '2026-10-14T00:00Z')],
            [issue('ABC-1', '2026-10-15T00:00Z', waiting=True),
             issue('ABC-2', '2026-10-16T00:00Z', waiting=True, state='In Progress'),
             issue('ABC-3', '2026-10-13T00:00Z')]]
    calls = []
    state = tmp_path / 'state/linear.json'

    def fake_herdr(*args):
        calls.append(args)
        return {}

    assert linear.poll(fake_herdr, texts, state, {}, fetch=lambda d: runs.pop(0),
                       now=datetime(2026, 10, 16, tzinfo=UTC))[0] == [
        f'* ABC-1     Backlog     {"":<20} about ABC-1',
        f'  ABC-2     Backlog     {"a":<20} about ABC-2']
    assert calls == []
    assert linear.poll(fake_herdr, texts, state, {}, fetch=lambda d: runs.pop(0),
                       now=datetime(2026, 10, 16, tzinfo=UTC))[0] == [
        f'* ABC-2     In Progress {"a":<20} about ABC-2',
        f'* ABC-1     Backlog     {"":<20} about ABC-1',
        f'  ABC-3     Backlog     {"":<20} about ABC-3']
    assert calls == [('notification', 'show', 'Linear ABC-2', '--body', 'about ABC-2 (a)',
                      '--sound', 'request')]


def test_compares_times_however_claude_writes_them():
    old = linear.remember(None, [issue('ABC-1', '2026-10-15T10:00:00.000Z', waiting=True),
                                 issue('ABC-2', 'yesterday', waiting=True),
                                 issue('ABC-3', '2026-08-01T00:00:00Z')],
                          now=datetime(2026, 10, 16, tzinfo=UTC))
    assert old == {'ABC-1': '2026-10-15T10:00:00', 'ABC-2': 'yesterday'}
    again = [issue('ABC-1', '2026-10-15T03:00:00-07:00', waiting=True),
             issue('ABC-2', 'yesterday', waiting=True)]
    assert linear.events(old, again) == []
    # One left out doesn't count as new when it is back.
    assert linear.remember(old, [], now=datetime(2026, 10, 16, tzinfo=UTC)) == old

    convs = [conversation('C1', '1.5', '1700000000.1', waiting=True)]
    old = slack.remember(None, convs, now=1700000100)
    assert slack.events(old, [conversation('C1', '1.5', '1700000000.100000', waiting=True)]) == []


def test_matches_odd_thread_ts_literally():
    texts = [('/p/a', None, 'p12(3')]
    assert slack.owner(conversation('C1', '12(3', '0'), texts, {})['project'] == '/p/a'
    assert slack.owner(conversation('C1', '1.2(', '0'), [], {}) is None


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
    assert pull_request.owner(pr, tree('org/app'), [])['dir'] == '/p/a/app'
    assert pull_request.owner(pr, tree(None), []) is None


def test_finds_what_waits_on_me_in_notes(tmp_path):
    (tmp_path / 'AGENT-main.md').write_text(
        '## Remaining\n'
        '- [you] Decide on the rollout\n'
        '  for the canary first.\n'
        '- [wait] CI on #12\n'
        '- Ask the user before pushing\n'
        '- Write the tests\n'
        '- Optional: post findings to the thread if the user asks\n'
        '- Base image commit reviewed, not pushed\n'
        '- Reported findings to the user\n'
        '- Nothing; answered the user.\n'
        '- None unless user wants a fix PR\n'
        '- [cleanup] Remove the worktree\n'
        '- None.\n'
        '\n'
        '## Log\n'
        '- [you] old\n')
    (tmp_path / 'AGENT-side.md').write_text('## Remaining\n- [You] Approve the plan\n')
    (tmp_path / 'README.md').write_text('## Remaining\n- [you] not an agent\n')
    assert inbox.note_items(tmp_path) == [
        {'role': 'main', 'mark': 'you', 'text': 'Decide on the rollout for the canary first.'},
        {'role': 'side', 'mark': 'you', 'text': 'Approve the plan'},
        {'role': 'main', 'mark': '?', 'text': 'Ask the user before pushing'},
        {'role': 'main', 'mark': '?', 'text': 'Base image commit reviewed, not pushed'},
        {'role': 'main', 'mark': 'maybe',
         'text': 'Optional: post findings to the thread if the user asks'}]


def test_keeps_watched_items(tmp_path):
    path = tmp_path / 'inbox.json'
    assert inbox.watched_items(path) == []
    one = {'project': '/p/a', 'role': None, 'mark': 'pr', 'text': '1'}
    two = {'project': None, 'role': None, 'mark': 'slack', 'text': '2'}
    inbox.write_sources(path, {'a': [one], 'b': [two]})
    assert inbox.read_sources(path) == {'a': [one], 'b': [two]}
    assert inbox.watched_items(path) == [one, two]
    assert [p.name for p in tmp_path.iterdir()] == ['inbox.json']
    path.write_text('[]')
    assert inbox.read_sources(path) == {}
    path.write_text(json.dumps({'a': [{'text': 't', 'mark': 'new', 'project': None, 'role': None},
                                      'junk', {'text': 1}], 'b': 'junk'}))
    assert inbox.watched_items(path) == [
        {'text': 't', 'mark': 'new', 'project': None, 'role': None}]


def test_lists_pull_requests_waiting_on_me():
    prs = pull_request.pull_requests(search(
        pr_node(1, 'a', checks='FAILURE', failed=['test']),
        pr_node(2, 'b', checks='SUCCESS', review='CHANGES_REQUESTED'),
        pr_node(3, 'c', checks='SUCCESS', review='APPROVED'),
        pr_node(4, 'd', checks='PENDING', review='APPROVED'),
        pr_node(5, 'e', state='MERGED', checks='FAILURE'),
        pr_node(6, 'f', checks='SUCCESS')))
    owners = {prs[0]['url']: {'project': '/p/a', 'dir': '/p/a/app', 'role': None}}
    assert [(i['project'], i['text']) for i in pull_request.waiting_items(prs, owners)] == [
        ('/p/a', 'app#1 checks failed: test: PR 1'),
        (None, 'app#2 changes requested: PR 2'),
        (None, 'app#3 approved, ready to merge: PR 3')]


def test_guesses_what_waits_on_me():
    assert [inbox.waiting(i) for i in [
        'Apply the change to staging (user)', 'Cleanup left (ask): branches',
        'Agree on the design with the user', 'Rollout not decided yet', 'Branch is local only',
        'Offer: file a ticket', 'Post outcome in the thread if user wants',
        'Rerun 4 timed-out clusters', 'Unverified: GPU containers work',
        '[ ] Decide on the rollout', '[x] Decide on the rollout', 'Is the user okay to push?',
        'Offers to file a ticket', 'Wrote notes for the user', 'Shared summary with the user',
        'PR approved, waiting on CI', 'Decision: went with B', 'Needs approval from the owner',
        'Confirm the plan with the user']] == [
        '?', '?', '?', '?', '?', 'maybe', 'maybe', None, None,
        '?', None, '?', 'maybe', None, None, None, None, '?', '?']


def test_closes_roles_and_then_the_project(tmp_path):
    (tmp_path / 'AGENT-a.md').write_text(
        'closed: https://x/pull/1\n\n## Remaining\n- [you] Stale\n\n## Findings\n- etcd needs 3\n')
    (tmp_path / 'AGENT-b.md').write_text('## Remaining\n- None.\n')
    (tmp_path / 'AGENT-c.md').write_text('## Remaining\n- [you] Decide X\n\n## Log\n- closed: no\n')
    assert [(i['role'], i['mark'], i['text']) for i in inbox.project_items(tmp_path)] == [
        ('c', 'you', 'Decide X'),
        ('b', 'close', 'Nothing remaining for b; tell its agent its part is done to close it')]
    # The watcher's items hold the suggestions back.
    watched = [{'project': str(tmp_path), 'role': None, 'mark': 'pr', 'text': 'app#1 failed'}]
    assert [i['mark'] for i in inbox.project_items(tmp_path, watched)] == ['you', 'pr']

    (tmp_path / 'AGENT-c.md').write_text('closed: decided X\n\n## Remaining\n')
    assert [i['text'] for i in inbox.project_items(tmp_path)] == [
        'Nothing remaining; tell its agent the task is done to close it']
    (tmp_path / 'AGENT-b.md').write_text('closed:\n\n## Remaining\n- None.\n')
    assert not inbox.role_closed((tmp_path / 'AGENT-b.md').read_text())

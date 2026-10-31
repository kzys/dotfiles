import http.server
import importlib.machinery
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import threading
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import install_codex
from herdr_project import agent as herdr_agent
from herdr_project import app as herdr_app


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class TestAgent:
    @pytest.fixture(autouse=True)
    def home(self, tmp_path):
        self.home = tmp_path

    def database(self):
        with closing(sqlite3.connect(self.home / 'state_5.sqlite')) as db:
            db.execute('CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, '
                       'updated_at INTEGER, archived INTEGER, source TEXT, rollout_path TEXT)')
            db.executemany('INSERT INTO threads VALUES (?,?,?,?,?,?,?)', [
                ('old', '/project', 'Old title', 1, 0, 'cli', '/gone'),
                ('new', '/project', 'New title', 2, 0, 'cli', '/gone'),
                ('archived', '/project', 'Archived', 3, 1, 'cli', '/gone'),
                ('child', '/project', 'Subagent', 4, 0, '{"subagent":{}}', '/gone'),
            ])
            db.commit()

    def test_selection(self):
        assert herdr_agent.parse_agent([]) == ('claude', [])
        assert herdr_agent.parse_agent(['--agent', 'codex', '--inbox']) == (
            'codex', ['--inbox'])
        assert herdr_agent.parse_agent(['--agent=codex', '--', '--agent', 'other']) == (
            'codex', ['--', '--agent', 'other'])
        assert herdr_agent.parse_agent(['--agent', 'opencode'], ('claude', 'opencode')) == (
            'opencode', [])
        # Scripts that know only Claude and Codex reject the others.
        with pytest.raises(SystemExit):
            herdr_agent.parse_agent(['--agent', 'opencode'])

    def test_database_sessions_include_missing_paginated_rollouts(self):
        self.database()
        assert [s['id'] for s in herdr_agent.codex_sessions(self.home)] == ['new', 'old']

    def test_legacy_fallback(self):
        sessions = self.home / 'sessions/2026/10/07'
        sessions.mkdir(parents=True)
        (sessions / 'rollout-id.jsonl').write_text(json.dumps({
            'type': 'session_meta', 'payload': {
                'id': 'id', 'cwd': '/project', 'source': 'cli'}}) + '\n')
        (sessions / 'broken.jsonl').write_text('broken')
        found = herdr_agent.codex_sessions(self.home)
        assert [(s['id'], s['cwd']) for s in found] == [('id', '/project')]

    def test_context_uses_current_usage_and_latest_event(self):
        path = self.home / 'rollout.jsonl'
        records = [{'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {
            'model_context_window': 1000,
            'total_token_usage': {'total_tokens': 9000},
            'last_token_usage': {'total_tokens': n}}}} for n in (100, 400)]
        path.write_text('\n'.join(map(json.dumps, records)) + '\npartial')
        assert herdr_agent.codex_context(path) == 40
        assert herdr_agent.codex_context(self.home / 'absent') is None

    def test_claude_launcher_preserved(self):
        launcher = load('herdr_project_claude', ROOT / 'bin/herdr-project')
        command, args, env = launcher.command('claude', ['--resume', 'id'])
        assert command == 'claude'
        assert '--append-system-prompt' in args
        assert args[-2:] == ['--resume', 'id']
        assert env == {'CLAUDE_CODE_SHELL': '/bin/bash'}

    @pytest.mark.parametrize('selection', [
        ['--agent', 'codex'], ['--agent=codex'], ['--agent', 'claude'],
    ])
    @pytest.mark.parametrize('arguments', [[], ['--resume', 'id']])
    def test_launcher_agent_selection(self, monkeypatch, selection, arguments):
        launcher = load('herdr_project_override', ROOT / 'bin/herdr-project')
        projects = self.home / 'project'
        checkout = self.home / 'checkout'
        checkout.mkdir()
        monkeypatch.chdir(checkout)
        monkeypatch.setattr(launcher, 'PROJECTS', projects)
        selected = selection[-1].split('=')[-1]
        monkeypatch.delenv('HERDR_ENV', raising=False)
        calls = []
        monkeypatch.setattr(launcher.os, 'execvp', lambda *args: calls.append(args))

        launcher.main([*selection, *arguments])

        program, args = calls[0]
        assert program == selected
        assert '--agent' not in args and '--agent=codex' not in args
        if arguments:
            assert Path.cwd() == checkout
            assert args[-2:] == (['resume', 'id'] if selected == 'codex' else arguments)
        else:
            assert Path.cwd().parent == projects
            assert args[args.index(str(checkout)) - 1] == '--add-dir'

    @pytest.mark.parametrize('arguments', [['--agent'], ['--agent', 'typo']])
    def test_launcher_rejects_invalid_agent_before_creating_project(self, monkeypatch, arguments):
        launcher = load('herdr_project_invalid_agent', ROOT / 'bin/herdr-project')
        projects = self.home / 'project'
        monkeypatch.setattr(launcher, 'PROJECTS', projects)
        with pytest.raises(SystemExit) as error:
            launcher.main(arguments)
        assert error.value.code == 2
        assert not projects.exists()

    def test_launcher_works_where_it_was_started(self):
        launcher = load('herdr_project_origin', ROOT / 'bin/herdr-project')
        for agent in ('claude', 'codex'):
            _, args, _ = launcher.command(agent, [], Path('/h/repos/org/app'))
            assert args[args.index('/h/repos/org/app') - 1] == '--add-dir'
            assert 'started in `/h/repos/org/app`' in ' '.join(args)
        # Claude also reads the checkout's CLAUDE.md.
        _, _, env = launcher.command('claude', [], Path('/h/repos/org/app'))
        assert env['CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD'] == '1'
        _, args, env = launcher.command('claude', [])
        assert 'outside ~/project' not in ' '.join(args)
        assert env == {'CLAUDE_CODE_SHELL': '/bin/bash'}

    def test_opencode_launcher_new_and_resume(self, monkeypatch):
        launcher = load('herdr_project_opencode', ROOT / 'bin/herdr-project')
        project = self.home / '20261027-abc'
        project.mkdir()
        monkeypatch.chdir(project)
        # The files of agents that have exited go.
        gone = subprocess.Popen(['true'])
        gone.wait()
        (self.home / 'state/opencode').mkdir(parents=True)
        (self.home / f'state/opencode/{gone.pid}.md').write_text('old')
        for arguments, tail in [([], []), (['--resume', 'id'], ['--session', 'id'])]:
            command, args, env = launcher.command('opencode', arguments, state=self.home / 'state')
            assert (command, args) == ('opencode', ['opencode', *tail])
            [path] = json.loads(env['OPENCODE_CONFIG_CONTENT'])['instructions']
            assert path == str(self.home / f'state/opencode/{os.getpid()}.md')
            assert not (self.home / f'state/opencode/{gone.pid}.md').exists()
            instructions = Path(path).read_text()
            assert '## Remaining' in instructions
            assert 'herdr-name-workspace' in instructions

    def test_codex_launcher_new_and_resume(self):
        launcher = load('herdr_project_codex', ROOT / 'bin/herdr-project')
        for arguments, tail in [([], []), (['--resume', 'id'], ['resume', 'id'])]:
            command, args, env = launcher.command('codex', arguments)
            assert command == 'codex'
            assert env == {}
            instructions = json.loads(args[args.index('-c') + 1].split('=', 1)[1])
            assert '## Remaining' in instructions
            assert 'herdr-name-workspace' in instructions
            if tail:
                assert args[-2:] == tail

    def test_adopt_passes_explicit_agent(self, monkeypatch):
        adopt = load('herdr_adopt_codex', ROOT / 'bin/herdr-adopt')
        monkeypatch.setattr(sys, 'argv', ['herdr-adopt', '--agent', 'codex'])
        monkeypatch.setattr(adopt, 'codex_sessions', list)
        monkeypatch.setattr(adopt.subprocess, 'run', lambda *a, **kw: SimpleNamespace(
            returncode=0, stdout=f'id\tSession\t{self.home}\n'))
        calls = []

        def herdr(*args):
            calls.append(args)
            return {'result': {'panes': [], 'root_pane': {'pane_id': 'new'}}}

        monkeypatch.setattr(adopt, 'herdr', herdr)
        adopt.main()
        assert calls[-1] == ('pane', 'run', 'new',
                             f'{ROOT}/bin/herdr-project --agent codex --resume id')

    def test_session_dirs_selects_codex(self, monkeypatch, capsys):
        dirs = load('agent_session_dirs_codex', ROOT / 'bin/agent-session-dirs')
        monkeypatch.setattr(sys, 'argv', ['agent-session-dirs', '--agent', 'codex', '--pick'])
        monkeypatch.setattr(dirs, 'codex_sessions', lambda: [
            {'cwd': '/project', 'title': 'Session', 'updated_at': 0}])
        inputs = []

        def pick(*args, **kwargs):
            inputs.append(kwargs['input'])
            return SimpleNamespace(returncode=0, stdout=kwargs['input'] + '\n')

        monkeypatch.setattr(dirs.subprocess, 'run', pick)
        assert dirs.main() == 0
        assert inputs == ['/project\t\t1970-01-01T00:00:00+00:00\tSession']
        assert capsys.readouterr().out == '/project\n'

    def test_picker_codex_session_and_title(self):
        self.database()
        picker = load('herdr_picker_codex', ROOT / 'bin/herdr-project-picker')
        codex = herdr_agent.codex_sessions(self.home)
        found = picker.sessions(Path('/project'), codex)
        assert [s['id'] for s in found] == ['new', 'old']
        assert picker.title(found[0]['source'], 'codex') == 'New title'

        def run(*args, **kwargs):
            raise AssertionError('Codex sessions never run in the background')

        assert picker.background('new', 'codex', run) is None

    def test_picker_reads_pane_list(self):
        picker = load('herdr_picker_panes', ROOT / 'bin/herdr-project-picker')
        listed = {'result': {'panes': [
            {'workspace_id': 'w', 'cwd': '/a', 'pane_id': 'shell', 'agent': None},
            {'workspace_id': 'w', 'cwd': '/b', 'pane_id': 'p', 'agent': 'codex',
             'agent_session': {'value': 'id'}, 'tokens': {'role': 'main'}},
        ]}}
        assert picker.pane_records(listed) == [
            {'agent': None, 'workspace': 'w', 'cwd': '/a', 'pane': 'shell', 'session': '',
             'role': ''},
            {'agent': 'codex', 'workspace': 'w', 'cwd': '/b', 'pane': 'p', 'session': 'id',
             'role': 'main'},
        ]

    def test_picker_lists_inbox(self):
        picker = load('herdr_picker_inbox', ROOT / 'bin/herdr-project-picker')
        old, new, quiet, done = (str(self.home / d) for d in
                                 ('20261001-a', '20261002-b', '20261003-c', '20261004-d'))

        def project(d, title, *items):
            return {'dir': d, 'title': title,
                    'items': [{'project': d, 'role': r, 'mark': m, 'text': x}
                              for r, m, x in items]}
        # herdr-project-web lists projects by its own rank.
        state = {
            'projects': [
                project(old, 'Old work', ('main', 'you', 'Decide X'),
                        ('main', 'maybe', 'Offer: a follow-up')),
                project(quiet, '(no title)'),
                project(new, '(no title)', ('main', 'pr', 'app#1 failed')),
                project(done, '(no title)', (None, 'close',
                        'Nothing remaining; tell its agent the task is done to close it')),
            ],
            'unowned': [{'project': None, 'role': None, 'mark': 'slack', 'text': 'Slack #x: hi'}],
        }
        codex = [{'id': 's2', 'cwd': new, 'updated_at': 2},
                 {'id': 's1', 'cwd': old, 'updated_at': 1}]
        panes = [{'agent': 'codex', 'workspace': 'w', 'cwd': new, 'pane': 'p',
                  'session': 's2', 'role': 'main'}]
        rows = list(picker.inbox_choices(panes, codex, state))
        assert rows == [
            f'project\t{done}\t\t20261004-d  (no title)',
            (f'session\t{done}\t\t             close? Nothing remaining; tell its agent the task is done '
             'to close it'),
            f'project\t{new}\t\t20261002-b  (no title)',
            f'session\t{new}\tcodex:s2\t  ● codex    pr     app#1 failed',
            f'project\t{old}\t\t20261001-a  Old work',
            f'session\t{old}\tcodex:s1\t    codex    you    Decide X',
            f'session\t{old}\tcodex:s1\t    codex    maybe  Offer: a follow-up',
            'new\t\t\t+ slack  Slack #x: hi',
        ]
        [row] = picker.inbox_choices(panes, codex, None)
        assert row.startswith('error\t\t\therdr-project-web isn\'t answering')

    def test_picker_reads_server_state(self):
        picker = load('herdr_picker_state', ROOT / 'bin/herdr-project-picker')
        state = {'projects': [], 'unowned': []}
        bodies = [json.dumps(state), '[]', json.dumps({'error': 'x'})]

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200 if self.path == '/api/state' else 404)
                self.end_headers()
                self.wfile.write(bodies.pop(0).encode())

            def log_message(self, *args):
                pass

        with http.server.HTTPServer(('127.0.0.1', 0), Handler) as server:
            port = server.server_port
            threading.Thread(target=lambda: [server.handle_request() for _ in range(3)],
                             daemon=True).start()
            assert picker.server_state(port) == state
            # Another server on the port isn't herdr-project-web.
            assert picker.server_state(port) is None
            assert picker.server_state(port) is None
        assert picker.server_state(port) is None

    def test_picker_reuses_workspace_with_shell_pane(self, monkeypatch):
        picker = load('herdr_picker_shell', ROOT / 'bin/herdr-project-picker')
        calls = []

        def herdr(*args):
            calls.append(args)
            return {'result': {'root_pane': {'pane_id': 'new'}}}

        panes = [{'workspace': 'w', 'cwd': str(self.home), 'pane': 'shell',
                  'agent': None, 'session': ''}]
        picker.open_picked(['project', str(self.home), ''], 'codex', panes, self.home, herdr)
        assert calls[0][:2] == ('tab', 'create')
        assert calls[-1][-1] == f'{ROOT}/bin/herdr-project --agent codex'

    def test_picker_focuses_running_session(self):
        picker = load('herdr_picker_focus', ROOT / 'bin/herdr-project-picker')
        calls = []
        panes = [{'workspace': 'w', 'cwd': str(self.home), 'pane': 'wrong-agent',
                  'agent': 'claude', 'session': 'id'},
                 {'workspace': 'w', 'cwd': str(self.home), 'pane': 'p',
                  'agent': 'codex', 'session': 'id'}]
        picker.open_picked(['session', str(self.home), 'codex:id'], 'claude', panes, self.home,
                           lambda *args: calls.append(args))
        assert calls == [('agent', 'focus', 'p')]

    def test_picker_merges_agents_and_marks_the_right_running_session(self, monkeypatch):
        picker = load('herdr_picker_mixed', ROOT / 'bin/herdr-project-picker')
        project = self.home / '20261001-a'
        project.mkdir()
        transcript = self.home / 'same.jsonl'
        transcript.write_text('{"type":"custom-title","customTitle":"Claude work"}\n')
        os.utime(transcript, (10, 10))
        monkeypatch.setattr(picker.claude, 'transcripts', lambda d: [transcript])
        codex = [{'id': 'same', 'cwd': str(project), 'updated_at': 20, 'title': 'Codex work'},
                 {'id': 'old', 'cwd': str(project), 'updated_at': 5, 'title': 'Old work'}]
        panes = [{'agent': 'claude', 'cwd': str(project), 'session': 'same'}]
        rows = [r.split('\t', 3) for r in picker.choices(panes, self.home, codex)]
        saved = [r for r in rows if r[0] == 'session']
        assert [r[2] for r in saved] == ['codex:same', 'claude:same', 'codex:old']
        assert '●' not in saved[0][3] and 'codex' in saved[0][3]
        assert '●' in saved[1][3] and 'claude' in saved[1][3]
        monkeypatch.setattr(picker, 'reported_role', lambda path: 'tester')
        monkeypatch.setattr(picker, 'notes', lambda directory, role: role)
        assert picker.row_notes('session', project, 'claude:same') == 'tester'
        assert picker.row_notes('session', project, 'codex:same') is None

    def test_picker_shows_new_session_choices_before_discovery(self, monkeypatch):
        picker = load('herdr_picker_fast_start', ROOT / 'bin/herdr-project-picker')
        from herdr_project.screen import Loading

        started, release = threading.Event(), threading.Event()

        def herdr(*args):
            started.set()
            assert release.wait(5)
            return {'result': {'panes': []}}

        monkeypatch.setattr(picker, 'codex_sessions', list)
        monkeypatch.setattr(picker, 'herdr', herdr)
        loading = Loading(picker.load_choices([], self.home))
        try:
            assert started.wait(5)
            assert loading.rows == [['new', '', '', '+ new project']]
            assert not loading.done
        finally:
            release.set()
            loading.wait()
        assert loading.done and loading.error is None

    @pytest.mark.parametrize('selected', ['claude', 'codex'])
    def test_picker_resumes_with_the_sessions_agent(self, monkeypatch, selected):
        picker = load('herdr_picker_resume', ROOT / 'bin/herdr-project-picker')
        monkeypatch.setattr(picker, 'background', lambda *args: None)
        calls = []
        panes = [{'workspace': 'w', 'cwd': str(self.home), 'pane': 'other',
                  'agent': 'codex' if selected == 'claude' else 'claude', 'session': 'same'}]

        def herdr(*args):
            calls.append(args)
            return {'result': {'root_pane': {'pane_id': 'new'}}}

        # The selected agent is for new sessions only.
        other = 'codex' if selected == 'claude' else 'claude'
        picker.open_picked(['session', str(self.home), f'{selected}:same'], other,
                           panes, self.home, herdr)
        assert calls[-1] == ('pane', 'run', 'new',
                             f'{ROOT}/bin/herdr-project --agent {selected} --resume same')

    def test_picker_routes_inbox_roles_across_agents(self):
        picker = load('herdr_picker_inbox_agents', ROOT / 'bin/herdr-project-picker')
        directory = str(self.home)
        panes = [{'agent': a, 'cwd': directory, 'session': a, 'role': r}
                 for a, r in [('claude', 'main'), ('codex', 'tester')]]
        state = {'projects': [{'dir': directory, 'title': 'Mixed work', 'items': [
            {'role': 'main', 'mark': 'you', 'text': 'Review design'},
            {'role': 'tester', 'mark': 'you', 'text': 'Review results'}]}], 'unowned': []}
        rows = [r.split('\t', 3) for r in picker.inbox_choices(panes, [], state)]
        assert [r[2] for r in rows if r[0] == 'session'] == ['claude:claude', 'codex:codex']

    def test_picker_starts_a_new_project_with_the_selected_agent(self):
        picker = load('herdr_picker_new_agent', ROOT / 'bin/herdr-project-picker')
        projects = self.home / 'projects'
        calls = []

        def herdr(*args):
            calls.append(args)
            return {'result': {'workspace': {'workspace_id': 'w'}, 'root_pane': {'pane_id': 'new'}}}

        picker.open_picked(['new', '', ''], 'codex', [], projects, herdr)
        [project] = projects.iterdir()
        assert calls[0][:3] == ('workspace', 'create', '--cwd')
        assert calls[0][3] == str(project)
        assert calls[-1] == ('pane', 'run', 'new', f'{ROOT}/bin/herdr-project --agent codex')

    def test_picker_lists_projects_with_agents_first(self):
        picker = load('herdr_picker_order', ROOT / 'bin/herdr-project-picker')
        projects = self.home / 'project'
        for name in ('20261001-a', '20261002-b', '20261003-c'):
            (projects / name).mkdir(parents=True)
        panes = [
            {'agent': 'codex', 'cwd': str(projects / '20261001-a/sub'), 'session': ''},
            {'agent': None, 'cwd': str(projects / '20261002-b'), 'session': ''},
        ]
        found = [line.split('\t')[1].rsplit('/', 1)[1]
                 for line in picker.choices(panes, projects, [])
                 if line.startswith('project')]
        assert found == ['20261001-a', '20261003-c', '20261002-b']

    def test_app_reads_panes_from_terminals(self):
        sessions = self.home / 'sessions'
        sessions.mkdir()
        (sessions / '7.json').write_text('{"pid": 7, "sessionId": "s"}')
        (sessions / 'broken.json').write_text('{')
        assert herdr_app.claude_sessions(sessions) == {7: 's'}
        space = {'herdr.space': 'sp'}
        terminals = [
            {'address': 't1', 'state': 'live', 'cwd': '/home', 'labels': space,
             'foreground': {'pid': 7, 'cwd': '/p'}, 'agent': 'claude-code'},
            {'address': 't2', 'state': 'live', 'cwd': '/a', 'labels': space,
             'foreground': None, 'agent': None},
            # Not in a space, so not the app's.
            {'address': 't3', 'state': 'live', 'cwd': '/b', 'labels': {}, 'agent': 'opencode'},
            {'address': 't4', 'state': 'live', 'cwd': '/c', 'labels': space,
             'foreground': {'pid': 7, 'cwd': '/c'}, 'agent': 'opencode'},
        ]
        assert herdr_app.pane_records(terminals, {7: 's'}) == [
            {'agent': 'claude', 'workspace': 'sp', 'cwd': '/p', 'pane': 't1', 'session': 's',
             'role': ''},
            {'agent': None, 'workspace': 'sp', 'cwd': '/a', 'pane': 't2', 'session': '',
             'role': ''},
            {'agent': 'opencode', 'workspace': 'sp', 'cwd': '/c', 'pane': 't4', 'session': '',
             'role': ''},
        ]

    def test_app_lists_panes_through_hc(self):
        got = {'t1': {'address': 't1', 'state': 'live', 'cwd': '/p',
                      'labels': {'herdr.space': 'sp'}, 'foreground': {'pid': 7, 'cwd': '/p'}}}

        def hc(*args):
            if args[0] == 'ls':
                return {'terminals': [{'address': 't1', 'agent': 'claude-code'},
                                      {'address': 'gone', 'agent': 'opencode'}]}
            if args[1] not in got:
                raise subprocess.CalledProcessError(1, ['hc', *args])
            return got[args[1]]

        assert herdr_app.panes(hc, {7: 's'}) == [
            {'agent': 'claude', 'workspace': 'sp', 'cwd': '/p', 'pane': 't1', 'session': 's',
             'role': ''},
        ]

    def test_picker_opens_rows_in_app(self, monkeypatch):
        picker = load('herdr_picker_app', ROOT / 'bin/herdr-project-picker')
        monkeypatch.setattr(picker, 'background', lambda *args: None)
        busy, quiet = self.home / '20261001-a', self.home / '20261002-b'
        busy.mkdir()
        quiet.mkdir()
        (quiet / 'README.md').write_text('---\nname: quiet\n---\n')
        panes = [{'agent': 'claude', 'workspace': 'sp', 'cwd': str(busy), 'pane': 't1',
                  'session': 'id'}]
        calls = []

        def run(name, args):
            calls.append((name, args))

        herdr_project = f'{ROOT}/bin/herdr-project'
        picker.open_in_app(['session', str(busy), 'claude:id'], 'codex', panes, self.home, run)
        picker.open_in_app(['session', str(busy), 'claude:old'], 'codex', panes, self.home, run)
        picker.open_in_app(['project', str(quiet), ''], 'codex', panes, self.home, run)
        picker.open_in_app(['error', '', ''], 'codex', panes, self.home, run)
        assert calls == [
            ('pane.focus', {'terminal': 't1'}),
            ('tab.new', {'space': 'sp', 'folder': str(busy),
                         'argv': [herdr_project, '--agent', 'claude', '--resume', 'old']}),
            ('space.new', {'name': 'quiet', 'folder': str(quiet),
                           'argv': [herdr_project, '--agent', 'codex']}),
        ]

    def test_hook_preserves_prompt_on_tool_event_and_skips_children(self):
        hook = load('codex_hook', ROOT / 'bin/codex-hook')
        data = {'session_id': 'id', 'cwd': str(self.home), 'hook_event_name': 'PostToolUse'}

        def sessions():
            return [{'id': 'id', 'title': 'Old title'}]

        args, usage = hook.report(data, {}, sessions, lambda directory: 'main')
        assert 'branch=main' in args
        assert not any(a.startswith('prompt=') for a in args)
        assert usage is None
        assert hook.report(data, {'CODEX_THREAD_ID': 'parent'}, sessions,
                           lambda directory: 'main') is None
        assert hook.pane({'HERDR_ENV': '1', 'HERDR_PANE_ID': 'p'}) == 'p'
        assert hook.pane({'HERDR_PANE_ID': 'p'}) is None
        assert hook.pane({'HERDR_ENV': '1'}) is None

    def test_hook_reports_context_usage(self):
        hook = load('codex_hook_usage', ROOT / 'bin/codex-hook')
        rollout = self.home / 'rollout.jsonl'
        rollout.write_text(json.dumps({'type': 'event_msg', 'payload': {
            'type': 'token_count', 'info': {'model_context_window': 1000,
                                            'last_token_usage': {'total_tokens': 250}}}}))
        data = {'session_id': 'id', 'cwd': str(self.home), 'transcript_path': str(rollout)}
        args, usage = hook.report(data, {}, list, lambda directory: '')
        assert 'ctx=25%' in args
        assert usage == (self.home / 'codex-id.json', '{"used_percentage": 25}')

    def test_install_hooks_is_idempotent_and_preserves_other_hooks(self):
        existing = {'other': True, 'hooks': {'Stop': [
            {'matcher': 'x', 'hooks': [{'type': 'command', 'command': 'other'}]}]}}
        updated = install_codex.add_hooks(existing, '/hook')
        assert updated == install_codex.add_hooks(updated, '/hook')
        assert updated['other']
        assert updated['hooks']['Stop'][0] == existing['hooks']['Stop'][0]
        assert existing['hooks'].keys() == {'Stop'}

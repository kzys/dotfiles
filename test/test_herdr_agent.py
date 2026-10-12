import importlib.machinery
import importlib.util
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import install_codex
from herdr_project import agent as herdr_agent


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
        assert herdr_agent.agent({}) == 'claude'
        assert herdr_agent.agent({'HERDR_PROJECT_AGENT': 'codex'}) == 'codex'
        with pytest.raises(SystemExit, match='claude or codex'):
            herdr_agent.agent({'HERDR_PROJECT_AGENT': 'typo'})

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

    def test_picker_codex_session_and_title(self):
        self.database()
        picker = load('herdr_picker_codex', ROOT / 'bin/herdr-project-picker')
        codex = herdr_agent.codex_sessions(self.home)
        found = picker.sessions(Path('/project'), 'codex', codex)
        assert [s['id'] for s in found] == ['new', 'old']
        assert picker.title(found[0], 'codex') == 'New title'

        def run(*args, **kwargs):
            raise AssertionError('Codex sessions never run in the background')

        assert picker.background('new', 'codex', run) is None

    def test_picker_reads_pane_list(self):
        picker = load('herdr_picker_panes', ROOT / 'bin/herdr-project-picker')
        listed = {'result': {'panes': [
            {'workspace_id': 'w', 'cwd': '/a', 'pane_id': 'shell', 'agent': None},
            {'workspace_id': 'w', 'cwd': '/b', 'pane_id': 'p', 'agent': 'codex',
             'agent_session': {'value': 'id'}},
        ]}}
        assert picker.pane_records(listed) == [
            {'agent': None, 'workspace': 'w', 'cwd': '/a', 'pane': 'shell', 'session': ''},
            {'agent': 'codex', 'workspace': 'w', 'cwd': '/b', 'pane': 'p', 'session': 'id'},
        ]

    def test_picker_reuses_workspace_with_shell_pane(self):
        picker = load('herdr_picker_shell', ROOT / 'bin/herdr-project-picker')
        calls = []

        def herdr(*args):
            calls.append(args)
            return {'result': {'root_pane': {'pane_id': 'new'}}}

        panes = [{'workspace': 'w', 'cwd': str(self.home), 'pane': 'shell',
                  'agent': None, 'session': ''}]
        picker.open_picked(['project', str(self.home), ''], panes, 'codex', self.home, herdr)
        assert calls[0][:2] == ('tab', 'create')
        assert calls[-1][-1].startswith('HERDR_PROJECT_AGENT=codex ')

    def test_picker_focuses_running_session(self):
        picker = load('herdr_picker_focus', ROOT / 'bin/herdr-project-picker')
        calls = []
        panes = [{'workspace': 'w', 'cwd': str(self.home), 'pane': 'p',
                  'agent': 'codex', 'session': 'id'}]
        picker.open_picked(['session', str(self.home), 'id'], panes, 'codex', self.home,
                           lambda *args: calls.append(args))
        assert calls == [('agent', 'focus', 'p')]

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
                 for line in picker.choices(panes, 'codex', projects, [])
                 if line.startswith('project')]
        assert found == ['20261001-a', '20261003-c', '20261002-b']

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

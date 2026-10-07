import importlib.machinery
import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'bin'))
import herdr_agent


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class AgentTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name)
        env = patch.dict(os.environ, {'CODEX_HOME': str(self.home)}, clear=True)
        env.start()
        self.addCleanup(env.stop)

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
        self.assertEqual(herdr_agent.agent(), 'claude')
        os.environ['HERDR_AGENT'] = 'codex'
        self.assertEqual(herdr_agent.agent(), 'codex')
        os.environ['HERDR_AGENT'] = 'typo'
        with self.assertRaisesRegex(SystemExit, 'claude or codex'):
            herdr_agent.agent()

    def test_database_sessions_include_missing_paginated_rollouts(self):
        self.database()
        self.assertEqual([s['id'] for s in herdr_agent.codex_sessions()], ['new', 'old'])

    def test_legacy_fallback(self):
        sessions = self.home / 'sessions/2026/10/07'
        sessions.mkdir(parents=True)
        (sessions / 'rollout-id.jsonl').write_text(json.dumps({
            'type': 'session_meta', 'payload': {
                'id': 'id', 'cwd': '/project', 'source': 'cli'}}) + '\n')
        (sessions / 'broken.jsonl').write_text('broken')
        found = herdr_agent.codex_sessions()
        self.assertEqual([(s['id'], s['cwd']) for s in found], [('id', '/project')])

    def test_context_uses_current_usage_and_latest_event(self):
        path = self.home / 'rollout.jsonl'
        records = [{'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {
            'model_context_window': 1000,
            'total_token_usage': {'total_tokens': 9000},
            'last_token_usage': {'total_tokens': n}}}} for n in (100, 400)]
        path.write_text('\n'.join(map(json.dumps, records)) + '\npartial')
        self.assertEqual(herdr_agent.codex_context(path), 40)
        self.assertIsNone(herdr_agent.codex_context(self.home / 'absent'))

    def test_claude_launcher_preserved(self):
        launcher = load('herdr_project_claude', ROOT / 'bin/herdr-project')
        with patch.object(launcher.os, 'execvp') as execute:
            launcher.main(['--resume', 'id'])
        command, args = execute.call_args.args
        self.assertEqual(command, 'claude')
        self.assertIn('--append-system-prompt', args)
        self.assertEqual(args[-2:], ['--resume', 'id'])
        self.assertEqual(os.environ['CLAUDE_CODE_SHELL'], '/bin/bash')

    def test_codex_launcher_new_and_resume(self):
        os.environ['HERDR_AGENT'] = 'codex'
        launcher = load('herdr_project_codex', ROOT / 'bin/herdr-project')
        # execvp never returns in real use.
        for arguments, tail in [([], []), (['--resume', 'id'], ['resume', 'id'])]:
            with patch.object(launcher.os, 'execvp', side_effect=SystemExit) as execute:
                with self.assertRaises(SystemExit):
                    launcher.main(arguments)
            command, args = execute.call_args.args
            self.assertEqual(command, 'codex')
            instructions = json.loads(args[args.index('-c') + 1].split('=', 1)[1])
            self.assertIn('## Remaining', instructions)
            self.assertIn('herdr-name-workspace', instructions)
            if tail:
                self.assertEqual(args[-2:], tail)

    def test_picker_codex_session_and_title(self):
        self.database()
        os.environ['HERDR_AGENT'] = 'codex'
        picker = load('herdr_picker_codex', ROOT / 'bin/herdr-project-picker')
        self.assertEqual([s['id'] for s in picker.sessions(Path('/project'))], ['new', 'old'])
        self.assertEqual(picker.title(picker.sessions(Path('/project'))[0]), 'New title')
        with patch.object(picker.subprocess, 'run') as run:
            self.assertIsNone(picker.background('new'))
            run.assert_not_called()

    def test_picker_reuses_workspace_with_shell_pane(self):
        os.environ['HERDR_AGENT'] = 'codex'
        picker = load('herdr_picker_shell', ROOT / 'bin/herdr-project-picker')
        picker.PROJECTS = self.home
        calls = []

        def herdr(*args):
            calls.append(args)
            if args == ('pane', 'list'):
                return {'result': {'panes': [{'workspace_id': 'w', 'cwd': str(self.home),
                                             'pane_id': 'shell', 'agent': None}]}}
            return {'result': {'root_pane': {'pane_id': 'new'}}}

        with patch.object(picker, 'herdr', side_effect=herdr), \
             patch.object(picker, 'pick', return_value=['project', str(self.home), '']), \
             patch.object(picker.subprocess, 'run'):
            picker.main()
        self.assertTrue(any(c[:2] == ('tab', 'create') for c in calls))
        self.assertTrue(calls[-1][-1].startswith('HERDR_AGENT=codex '))

    def test_picker_focuses_running_session(self):
        os.environ['HERDR_AGENT'] = 'codex'
        picker = load('herdr_picker_focus', ROOT / 'bin/herdr-project-picker')
        picker.PROJECTS = self.home
        panes = {'result': {'panes': [{'workspace_id': 'w', 'cwd': str(self.home),
                 'pane_id': 'p', 'agent': 'codex', 'agent_session': {'value': 'id'}}]}}
        with patch.object(picker, 'herdr', return_value=panes) as herdr, \
             patch.object(picker, 'pick', return_value=['session', str(self.home), 'id']):
            picker.main()
        herdr.assert_called_with('agent', 'focus', 'p')

    def test_hook_preserves_prompt_on_tool_event_and_skips_children(self):
        hook = load('codex_hook', ROOT / 'bin/codex-hook')
        os.environ.update(HERDR_ENV='1', HERDR_PANE_ID='pane')
        data = {'session_id': 'id', 'cwd': str(self.home), 'hook_event_name': 'PostToolUse'}
        from io import StringIO
        with patch.object(hook.sys, 'stdin', StringIO(json.dumps(data))), \
             patch.object(hook.subprocess, 'run') as run, \
             patch.object(hook, 'codex_sessions', return_value=[{'id': 'id', 'title': 'Old title'}]):
            run.return_value.stdout = 'main\n'
            hook.main()
        args = run.call_args.args[0]
        self.assertIn('branch=main', args)
        self.assertFalse(any(a.startswith('prompt=') for a in args))
        os.environ['CODEX_THREAD_ID'] = 'parent'
        with patch.object(hook.sys, 'stdin', StringIO(json.dumps(data))), \
             patch.object(hook.subprocess, 'run') as run:
            hook.main()
        run.assert_not_called()

    def test_install_hooks_is_idempotent_and_preserves_other_hooks(self):
        installer = load('install_codex', ROOT / 'install-codex.py')
        existing = {'other': True, 'hooks': {'Stop': [
            {'matcher': 'x', 'hooks': [{'type': 'command', 'command': 'other'}]}]}}
        updated = installer.add_hooks(existing, '/hook')
        self.assertEqual(updated, installer.add_hooks(updated, '/hook'))
        self.assertTrue(updated['other'])
        self.assertEqual(updated['hooks']['Stop'][0], existing['hooks']['Stop'][0])
        self.assertEqual(existing['hooks'].keys(), {'Stop'})


if __name__ == '__main__':
    unittest.main()

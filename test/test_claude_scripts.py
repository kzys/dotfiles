import importlib.machinery
import importlib.util
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name, path):
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


statusline = load('claude_statusline', ROOT / 'bin/claude-statusline')
hook = load('claude_hook', ROOT / 'bin/claude-hook')


def test_percent():
    assert statusline.percent({'context_window': {'used_percentage': 12.7}}) == 12
    assert statusline.percent({'context_window': {
        'current_usage': {'input_tokens': 1000, 'cache_read_input_tokens': 49000},
        'context_window_size': 200000}}) == 25
    assert statusline.percent({'context_window': {'used_percentage': 'x'}}) is None
    assert statusline.percent({'context_window': {'current_usage': {}}}) is None
    assert statusline.percent({}) is None


def test_status_shows_every_part():
    data = {
        'context_window': {'context_window_size': 1000000},
        'model': {'display_name': 'Opus'},
        'effort': {'level': 'high'},
        'prompt_cache': {'warm': True, 'expires_at': 1600},
        'rate_limits': {'five_hour': {'used_percentage': 33.3, 'resets_at': 5000},
                        'seven_day': {'used_percentage': 5}},
    }
    got = statusline.status(data, 12, 1000, lambda t: f'@{t}')
    assert got == '12% of 1M ctx · Opus (high) · cache 10m · 5h 33% (@5000) · 7d 5%'


def test_status_leaves_out_malformed_parts():
    data = {
        'context_window': {'context_window_size': 1500000},
        'model': 'bad',
        'prompt_cache': {'warm': False},
        'rate_limits': {'five_hour': {'used_percentage': 'x'}, 'seven_day': []},
    }
    assert statusline.status(data, 40, 0, str) == '40% of 1.5M ctx · cache cold'
    assert statusline.status({'context_window': {'context_window_size': 200000}},
                             1, 0, str) == '1% of 200k ctx'
    assert statusline.status({}, 1, 0, str) == '1% ctx'


def test_usage(tmp_path):
    data = {'session_id': 's', 'workspace': {'project_dir': str(tmp_path)},
            'context_window': {'used_percentage': 12.7, 'context_window_size': 1000}}
    path, contents = statusline.usage(data)
    assert path == tmp_path / 'claude-s.json'
    assert json.loads(contents) == {'used_percentage': 12.7, 'context_window_size': 1000}
    assert statusline.usage({'session_id': 's', 'cwd': str(tmp_path / 'gone')}) is None


def run(script, data, tmp_path):
    """Runs script in a Herdr pane whose herdr command succeeds without
    output."""
    env = {**os.environ, 'HERDR_ENV': '1', 'HERDR_PANE_ID': 'p', 'HERDR_BIN_PATH': 'true',
           'HOME': str(tmp_path)}
    return subprocess.run([ROOT / 'bin' / script], input=data, env=env,
                          capture_output=True, text=True, check=False)


def test_status_line_survives_bad_input(tmp_path):
    got = run('claude-statusline', '{"context_window":{"used_percentage":5},"cwd":5}', tmp_path)
    assert (got.returncode, got.stdout, got.stderr) == (0, '5% ctx\n', '')
    got = run('claude-statusline', '{"context_window":{"used_percentage":NaN}}', tmp_path)
    assert (got.returncode, got.stdout, got.stderr) == (0, '', '')
    got = run('claude-statusline', 'garbage', tmp_path)
    assert (got.returncode, got.stdout, got.stderr) == (0, '', '')


def test_hook_survives_bad_input(tmp_path):
    for data in ['{"hook_event_name":"SessionStart","session_id":5}',
                 '{"hook_event_name":"SessionStart","session_id":"s"}', '5', 'garbage']:
        got = run('claude-hook', data, tmp_path)
        assert (got.returncode, got.stdout, got.stderr) == (0, '', ''), data


def test_usage_follows_jq_alternatives(tmp_path):
    data = {'session_id': 's', 'workspace': {'project_dir': ''}, 'cwd': str(tmp_path)}
    assert statusline.usage(data) is None


def test_last_prompt(tmp_path):
    transcript = tmp_path / 't.jsonl'
    transcript.write_text('\n'.join(json.dumps(line, ensure_ascii=False) for line in [
        {'type': 'last-prompt', 'lastPrompt': 'old'},
        {'type': 'last-prompt', 'lastPrompt': ' new\n  prompt\u2028 '},
        {'type': 'other'},
    ]))
    assert statusline.last_prompt(transcript) == 'new prompt'
    assert statusline.last_prompt(tmp_path / 'gone') == ''
    assert statusline.last_prompt(None) == ''


def test_metadata():
    data = {'workspace': {'current_dir': '/home/u/src'}, 'model': {'display_name': 'Opus'}}
    args = statusline.metadata(data, 12, 'hi', lambda d: f'b:{d}', '/home/u', True)
    assert args == ['--clear-token', 'bg', '--token', 'cwd=/home/u/src',
                    '--token', 'ctx=12%', '--token', 'prompt=hi', '--token', 'model=Opus',
                    '--token', 'dir=~/src', '--token', 'branch=b:/home/u/src']
    args = statusline.metadata(data, 12, '', lambda d: '', '/home/u', False)
    assert args[:2] == ['--token', 'bg=bg']
    assert 'cwd=/home/u/src' not in args


def test_hook_session_start():
    data = {'session_id': 's', 'transcript_path': '/t', 'source': 'resume'}
    assert hook.session_start(data, 7) == [
        '--source', 'herdr:claude', '--agent', 'claude', '--seq', '7',
        '--agent-session-id', 's', '--agent-session-path', '/t',
        '--session-start-source', 'resume']
    assert hook.session_start({'session_id': 's'}, 7)[-2:] == ['--agent-session-id', 's']
    assert hook.session_start({'session_id': 's', 'agent_id': 'a'}, 7) is None
    assert hook.session_start({}, 7) is None


def test_hook_gives_instructions_on_resume(tmp_path):
    project = tmp_path / 'project' / '20261016-x'
    (project / 'repo').mkdir(parents=True)
    calls = tmp_path / 'calls'
    fake = tmp_path / 'herdr'
    fake.write_text(f'#!/bin/sh\necho "$@" >> {calls}\nexit "${{FAIL:-0}}"\n')
    fake.chmod(0o755)
    data = json.dumps({'hook_event_name': 'SessionStart', 'session_id': 's',
                       'source': 'resume', 'cwd': str(project / 'repo')})

    def hook(**env):
        return subprocess.run(
            [ROOT / 'bin/claude-hook'], input=data, capture_output=True, text=True, check=False,
            env={**os.environ, 'HERDR_ENV': '1', 'HERDR_PANE_ID': 'p',
                 'HERDR_BIN_PATH': str(fake), 'HOME': str(tmp_path), **env})

    got = hook()
    assert got.returncode == 0
    assert '## Remaining' in got.stdout
    assert f'this task\'s is\n`{project}`' in got.stdout
    assert 'pane report-agent-session p ' in calls.read_text()

    # A failing report doesn't keep the instructions out.
    assert '## Remaining' in hook(FAIL='1').stdout


def test_hook_reports_the_role_again_on_resume(tmp_path):
    transcript = tmp_path / 's.jsonl'
    report = ('herdr pane report-metadata "$HERDR_PANE_ID" --source agent-notes '
              '--token role={}')
    transcript.write_text('\n'.join(json.dumps({'message': {'content': [
        {'type': 'tool_use', 'input': {'command': report.format(role)}}]}})
        for role in ['first', 'main']) + '\n')
    calls = tmp_path / 'calls'
    fake = tmp_path / 'herdr'
    got = tmp_path / 'pane.json'
    got.write_text('{"result": {"pane": {"tokens": {}}}}')
    fake.write_text(f'#!/bin/sh\necho "$@" >> {calls}\n[ "$1 $2" = "pane get" ] && cat {got}\n'
                    'exit 0\n')
    fake.chmod(0o755)
    data = {'hook_event_name': 'SessionStart', 'session_id': 's', 'source': 'resume',
            'cwd': str(tmp_path), 'transcript_path': str(transcript)}

    def roles(env=None, **changed):
        calls.unlink(missing_ok=True)
        subprocess.run([ROOT / 'bin/claude-hook'], input=json.dumps({**data, **changed}),
                       capture_output=True, text=True, check=False,
                       env={**os.environ, 'HERDR_ENV': '1', 'HERDR_PANE_ID': 'p',
                            'HERDR_BIN_PATH': str(fake), 'HOME': str(tmp_path),
                            **(env or {})})
        made = calls.read_text().splitlines() if calls.exists() else []
        return [line for line in made if line.startswith('pane report-metadata')]

    assert roles() == ['pane report-metadata p --source agent-notes --token role=main']
    assert roles(source='startup') == []
    assert roles(agent_id='a') == []
    assert roles(env={'HERDR_ENV': ''}) == []
    # A pane that has a role keeps it.
    got.write_text('{"result": {"pane": {"tokens": {"role": "other"}}}}')
    assert roles() == []
    got.write_text('{"result": {"pane": {"tokens": {}}}}')
    transcript.write_text('')
    assert roles() == []


def test_hook_gives_instructions_only_on_resume_in_a_project(tmp_path):
    (tmp_path / 'project' / 'x').mkdir(parents=True)
    data = {'hook_event_name': 'SessionStart', 'session_id': 's', 'source': 'resume',
            'cwd': str(tmp_path / 'project' / 'x')}
    for changed in [{'source': 'startup'}, {'agent_id': 'a'}, {'cwd': str(tmp_path)}]:
        got = run('claude-hook', json.dumps({**data, **changed}), tmp_path)
        assert (got.returncode, got.stdout) == (0, ''), changed


def test_hook_fails_when_a_step_fails(tmp_path):
    data = {'hook_event_name': 'SessionStart', 'session_id': '\ud800', 'source': 'resume',
            'cwd': str(tmp_path), 'transcript_path': str(tmp_path / 't.jsonl')}
    got = run('claude-hook', json.dumps(data), tmp_path)
    assert got.returncode == 1
    assert 'UnicodeEncodeError' in got.stderr

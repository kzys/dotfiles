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

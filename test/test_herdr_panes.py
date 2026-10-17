import json
import subprocess
from datetime import UTC, datetime, timedelta

from herdr_project import panes


def pane(pane_id, tab, agent=None, status='unknown', cwd='/h', **tokens):
    return {'pane_id': pane_id, 'tab_id': tab, 'agent': agent, 'agent_status': status,
            'cwd': cwd, 'tokens': tokens}


def test_polls_panes(tmp_path):
    root = tmp_path / 'project'
    (root / '20261016-a').mkdir(parents=True)
    (root / '20261016-a/README.md').write_text('---\nname: alpha\n---\n')
    project = str(root / '20261016-a')
    listed = [
        pane('w1:p1', 'w1:t1', agent='claude', status='working', cwd=project,
             ctx='85%', role='main'),
        pane('w1:p2', 'w1:t1', cwd=project),  # Follows the agent's notes.
        pane('w2:p1', 'w2:t1'),
        pane('w3:p1', 'w3:t1', cwd=project),
    ]
    texts = {'w2:p1': '$ ls', 'w3:p1': '$ make'}
    calls = []

    def herdr(*args):
        calls.append(args)
        return {'result': {'panes': listed}} if args[:2] == ('pane', 'list') else {}

    def poll(at):
        return panes.poll(herdr, root, state, start + at, read=texts.__getitem__)

    state = tmp_path / 'state/panes.json'
    start = datetime(2026, 10, 16, 9, tzinfo=UTC)
    lines, items = poll(timedelta())
    assert lines == [' 85% w1:p1    alpha']
    assert items == [{'project': project, 'role': 'main', 'mark': 'ctx',
                      'text': 'alpha: context 85% full, restart it from its notes'}]
    # A working agent isn't interrupted.
    assert calls == [('pane', 'list')]

    listed[0]['agent_status'] = 'idle'
    calls.clear()
    lines, items = poll(timedelta(days=1, hours=2))
    assert lines == [' 85% w1:p1    alpha', '  1d w2:p1    /h', '  1d w3:p1    alpha']
    # Only idle panes in projects go to the inbox.
    assert items[1:] == [{'project': project, 'role': None, 'mark': 'idle',
                          'text': 'shell pane w3:p1 idle for 1d'}]
    assert calls == [('pane', 'list'), ('pane', 'run', 'w1:p1', panes.wake_message(listed[0]))]

    # The agent is told once, even while its ctx is unknown, and again
    # only after its context empties.
    calls.clear()
    del listed[0]['tokens']['ctx']
    poll(timedelta(days=1, hours=3))
    listed[0]['tokens']['ctx'] = '85%'
    poll(timedelta(days=1, hours=4))
    assert calls == [('pane', 'list')] * 2
    listed[0]['tokens']['ctx'] = '10%'
    poll(timedelta(days=1, hours=5))
    listed[0]['tokens']['ctx'] = '90%'
    calls.clear()
    poll(timedelta(days=1, hours=6))
    assert calls[1][:3] == ('pane', 'run', 'w1:p1')

    # New text restarts the idle clock.
    texts['w2:p1'] = '$ ls\nREADME.md'
    lines, _ = poll(timedelta(days=1, hours=7))
    assert lines == [' 90% w1:p1    alpha', '  1d w3:p1    alpha']
    assert json.loads(state.read_text())['told'] == ['w1:p1']


def test_tells_only_idle_or_done_agents_in_projects(tmp_path):
    (tmp_path / 'a').mkdir()
    for status, cwd, told in [('idle', 'a', True), ('done', 'a', True), ('idle', '', False),
                              ('working', 'a', False), ('blocked', 'a', False),
                              ('unknown', 'a', False)]:
        listed = [pane('w1:p1', 't', agent='claude', status=status, ctx='90%',
                       cwd=str(tmp_path / cwd))]
        calls = []

        def herdr(*args, listed=listed, calls=calls):
            calls.append(args)
            return {'result': {'panes': listed}}

        _, items = panes.poll(herdr, tmp_path, tmp_path / f'{status}{cwd}.json',
                              datetime(2026, 10, 16, tzinfo=UTC), read=lambda _: '')
        assert (len(calls) == 2) == told, (status, cwd)
        assert len(items) == (1 if cwd else 0)


def test_ignores_background_sessions_ctx(tmp_path):
    listed = [pane('w1:p1', 't', agent='claude', status='idle', ctx='95%', bg='bg')]
    calls = []

    def herdr(*args):
        calls.append(args)
        return {'result': {'panes': listed}}

    lines, items = panes.poll(herdr, tmp_path, tmp_path / 'panes.json',
                              datetime(2026, 10, 16, tzinfo=UTC), read=lambda _: '')
    assert (lines, items, calls) == (['Nothing to clean up.'], [], [('pane', 'list')])


def test_keeps_going_when_an_agent_cannot_be_told(tmp_path):
    (tmp_path / 'a').mkdir()
    listed = [pane('w1:p1', 't', agent='claude', status='done', ctx='99%',
                   cwd=str(tmp_path / 'a'))]

    def herdr(*args):
        if args[:2] == ('pane', 'run'):
            raise subprocess.CalledProcessError(1, 'herdr')
        return {'result': {'panes': listed}}

    state = tmp_path / 'panes.json'
    lines, _ = panes.poll(herdr, tmp_path, state, datetime(2026, 10, 16, tzinfo=UTC),
                          read=lambda _: '')
    assert lines == [' 99% w1:p1    a']
    assert json.loads(state.read_text())['told'] == []


def test_starts_over_from_bad_state(tmp_path):
    state = tmp_path / 'panes.json'
    state.write_text('{"panes": [], "told": 5}')
    lines, _ = panes.poll(lambda *a: {'result': {'panes': [pane('w1:p1', 't')]}}, tmp_path,
                          state, datetime(2026, 10, 16, tzinfo=UTC), read=lambda _: '')
    assert lines == ['Nothing to clean up.']
    assert list(json.loads(state.read_text())['panes']) == ['w1:p1']


def test_reads_ctx():
    assert panes.ctx({'tokens': {'ctx': '17%'}}) == 17
    assert panes.ctx({'tokens': {'ctx': '17%', 'bg': 'bg'}}) is None
    assert panes.ctx({'tokens': {'ctx': 'x'}}) is None
    assert panes.ctx({'tokens': None}) is None
    assert panes.ctx({}) is None

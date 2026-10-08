import importlib.machinery
import importlib.util
import pathlib
import pytest

INSTALL_CLAUDE = pathlib.Path(__file__).resolve().parent.parent / 'install-claude.py'


def load(path):
    """Import a script that has no .py suffix."""
    loader = importlib.machinery.SourceFileLoader(path.name, str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


install_claude = load(INSTALL_CLAUDE)

LINE = {'type': 'command', 'command': '/x/claude-statusline', 'refreshInterval': 60}


class TestUpdate:
    def test_adds_the_status_line_and_keeps_the_rest(self):
        assert (
            install_claude.update({'theme': 'auto'}, '/x/claude-statusline')
            == {'theme': 'auto', 'statusLine': LINE})

    def test_leaves_the_same_status_line_as_it_is(self):
        settings = {'statusLine': {**LINE, 'padding': 1}}
        assert (
            install_claude.update(settings, '/x/claude-statusline')
            == settings)

    def test_adds_a_refresh_interval_to_the_same_status_line(self):
        settings = {'statusLine': {'type': 'command', 'command': '/x/claude-statusline'}}
        assert (
            install_claude.update(settings, '/x/claude-statusline')
            == {'statusLine': LINE})

    def test_keeps_a_refresh_interval_set_by_hand(self):
        settings = {'statusLine': {**LINE, 'refreshInterval': 5}}
        assert (
            install_claude.update(settings, '/x/claude-statusline')
            == settings)

    def test_takes_a_tilde_path_as_the_same_status_line(self):
        home = pathlib.Path.home()
        settings = {'statusLine': {**LINE, 'command': '~/x/claude-statusline'}}
        assert (
            install_claude.update(settings, f'{home}/x/claude-statusline')
            == settings)

    def test_refuses_to_replace_another_status_line(self):
        settings = {'statusLine': {'type': 'command', 'command': 'other'}}
        with pytest.raises(ValueError):
            install_claude.update(settings, '/x/claude-statusline')


HERDR = {'type': 'command', 'command': "bash '/h/.claude/hooks/herdr-agent-state.sh' session"}
HOOK = {'type': 'command', 'command': '/x/claude-hook'}


class TestAddHooks:
    def test_adds_the_hook_and_keeps_the_rest(self):
        assert (
            install_claude.add_hooks({'theme': 'auto'}, '/x/claude-hook')
            == {'theme': 'auto', 'hooks': {'SessionStart': [{'hooks': [HOOK]}]}})

    def test_replaces_herdrs_hook(self):
        settings = {'hooks': {'SessionStart': [{'matcher': 'startup', 'hooks': [HERDR]}]}}
        assert (
            install_claude.add_hooks(settings, '/x/claude-hook')
            == {'hooks': {'SessionStart': [{'hooks': [HOOK]}]}})

    def test_keeps_other_hooks_in_a_group_with_herdrs(self):
        mine = {'type': 'command', 'command': 'mine'}
        settings = {'hooks': {'SessionStart': [{'matcher': 'startup', 'hooks': [HERDR, mine]}]}}
        assert (
            install_claude.add_hooks(settings, '/x/claude-hook')
            == {'hooks': {'SessionStart': [{'matcher': 'startup', 'hooks': [mine]}, {'hooks': [HOOK]}]}})

    def test_replaces_the_old_hook_name(self):
        old = {'type': 'command', 'command': '/x/claude-herdr-session'}
        settings = {'hooks': {'SessionStart': [{'hooks': [old]}]}}
        assert (
            install_claude.add_hooks(settings, '/x/claude-hook')
            == {'hooks': {'SessionStart': [{'hooks': [HOOK]}]}})

    def test_keeps_other_hooks(self):
        other = {'hooks': [{'type': 'command', 'command': 'other'}]}
        settings = {'hooks': {'SessionStart': [other], 'Stop': [other]}}
        assert (
            install_claude.add_hooks(settings, '/x/claude-hook')
            == {'hooks': {'SessionStart': [other, {'hooks': [HOOK]}], 'Stop': [other]}})

    def test_leaves_an_installed_hook_as_it_is(self):
        settings = {'hooks': {'SessionStart': [{'matcher': 'startup', 'hooks': [{**HOOK, 'timeout': 5}]}]}}
        assert install_claude.add_hooks(settings, '/x/claude-hook') is settings


class TestPruneProjects:
    def test_drops_deleted_directories_under_home(self):
        state = {'projects': {'/h/a': {'x': 1}, '/h/gone': {}}, 'other': 1}
        assert (
            install_claude.prune_projects(state, {'/h'}, gone=lambda p: p == '/h/gone')
            == {'projects': {'/h/a': {'x': 1}}, 'other': 1})

    def test_matches_any_of_the_homes(self):
        state = {'projects': {'/var/home/u/gone': {}}}
        assert (
            install_claude.prune_projects(state, {'/home/u', '/var/home/u'}, gone=lambda p: True)
            == {'projects': {}})

    def test_keeps_directories_outside_home(self):
        state = {'projects': {'/media/drive': {}}}
        assert install_claude.prune_projects(state, {'/h'}, gone=lambda p: True) is state

    def test_keeps_home_itself(self):
        state = {'projects': {'/h': {}}}
        assert install_claude.prune_projects(state, {'/h'}, gone=lambda p: True) is state

    def test_leaves_state_without_projects_alone(self):
        assert install_claude.prune_projects({}, {'/h'}) == {}
        assert install_claude.prune_projects([], {'/h'}) == []


class TestGone:
    @pytest.fixture(autouse=True)
    def dir(self, tmp_path):
        self.dir = tmp_path

    def test_existing_directory(self):
        assert not install_claude.gone(str(self.dir))

    def test_missing_directory_beside_others(self):
        (self.dir / 'other').mkdir()
        assert install_claude.gone(str(self.dir / 'deleted'))

    def test_missing_directory_under_an_empty_one(self):
        (self.dir / 'mnt').mkdir()
        assert not install_claude.gone(str(self.dir / 'mnt' / 'project'))

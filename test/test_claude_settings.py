import importlib.machinery
import importlib.util
import pathlib
import unittest

CLAUDE_SETTINGS = pathlib.Path(__file__).resolve().parent.parent / 'bin' / 'claude-settings'


def load(path):
    """Import a script that has no .py suffix."""
    loader = importlib.machinery.SourceFileLoader(path.name, str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


claude_settings = load(CLAUDE_SETTINGS)

LINE = {'type': 'command', 'command': '/x/claude-statusline'}


class TestUpdate(unittest.TestCase):
    def test_adds_the_status_line_and_keeps_the_rest(self):
        self.assertEqual(
            claude_settings.update({'theme': 'auto'}, '/x/claude-statusline'),
            {'theme': 'auto', 'statusLine': LINE})

    def test_leaves_the_same_status_line_as_it_is(self):
        settings = {'statusLine': {**LINE, 'padding': 1}}
        self.assertEqual(
            claude_settings.update(settings, '/x/claude-statusline'), settings)

    def test_takes_a_tilde_path_as_the_same_status_line(self):
        home = pathlib.Path.home()
        settings = {'statusLine': {'type': 'command', 'command': '~/x/claude-statusline'}}
        self.assertEqual(
            claude_settings.update(settings, f'{home}/x/claude-statusline'), settings)

    def test_refuses_to_replace_another_status_line(self):
        settings = {'statusLine': {'type': 'command', 'command': 'other'}}
        with self.assertRaises(ValueError):
            claude_settings.update(settings, '/x/claude-statusline')

import importlib.util
from pathlib import Path
import tempfile
import tomllib
import unittest


spec = importlib.util.spec_from_file_location(
    'install_codex', Path(__file__).resolve().parent.parent / 'install-codex.py')
install_codex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install_codex)
PREFERENCES = install_codex.CONFIG.read_text()


class TestConfig(unittest.TestCase):
    def test_replaces_preferences_and_preserves_app_state(self):
        current = '''# local settings
approval_policy = "never"
approvals_reviewer = "user"
sandbox_mode = "read-only"
notify = ["/local/app", "turn-ended"]

[desktop]
conversationDetailMode = "STEPS_COMMANDS"
[hooks.state."/local/hooks.json:stop:0:0"]
trusted_hash = "sha256:abc"
[profiles.manual]
approval_policy = "on-request"
'''
        updated = install_codex.update_config(current, PREFERENCES)
        self.assertEqual(tomllib.loads(updated),
                         {**tomllib.loads(current), **tomllib.loads(PREFERENCES)})
        self.assertIn(current[current.index('[desktop]'):], updated)
        self.assertIn('# local settings', updated)
        self.assertEqual(install_codex.update_config(updated, PREFERENCES), updated)

    def test_refuses_to_damage_a_multiline_value(self):
        current = 'notify = \'\'\'hello\napproval_policy = "never"\nworld\'\'\'\n'
        with self.assertRaises(ValueError):
            install_codex.update_config(current, PREFERENCES)

    def test_installs_new_config_and_keeps_file_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / 'codex'
            install_codex.install_config(home)
            path = home / 'config.toml'
            self.assertEqual(tomllib.loads(path.read_text()), tomllib.loads(PREFERENCES))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            path.chmod(0o640)
            path.write_text('model = "example"\n')
            install_codex.install_config(home)
            self.assertEqual(path.stat().st_mode & 0o777, 0o640)
            self.assertEqual(tomllib.loads(path.read_text())['model'], 'example')


if __name__ == '__main__':
    unittest.main()

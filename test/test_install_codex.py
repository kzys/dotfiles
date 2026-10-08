import tomllib

import pytest


import install_codex

PREFERENCES = install_codex.CONFIG.read_text()


def test_replaces_preferences_and_preserves_app_state():
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
    assert tomllib.loads(updated) == {**tomllib.loads(current), **tomllib.loads(PREFERENCES)}
    assert current[current.index('[desktop]'):] in updated
    assert '# local settings' in updated
    assert install_codex.update_config(updated, PREFERENCES) == updated


def test_refuses_to_damage_a_multiline_value():
    current = 'notify = \'\'\'hello\napproval_policy = "never"\nworld\'\'\'\n'
    with pytest.raises(ValueError):
        install_codex.update_config(current, PREFERENCES)


def test_installs_new_config_and_keeps_file_permissions(tmp_path):
    home = tmp_path / 'codex'
    install_codex.install_config(home)
    path = home / 'config.toml'
    assert tomllib.loads(path.read_text()) == tomllib.loads(PREFERENCES)
    assert path.stat().st_mode & 0o777 == 0o600
    path.chmod(0o640)
    path.write_text('model = "example"\n')
    install_codex.install_config(home)
    assert path.stat().st_mode & 0o777 == 0o640
    assert tomllib.loads(path.read_text())['model'] == 'example'

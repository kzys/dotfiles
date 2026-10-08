#!/usr/bin/env python3
"""Install Codex preferences and Herdr/sidebar metadata hooks.

Codex also writes app settings and local state to config.toml, so merge
the preferences instead of linking the whole file into this repository.
"""

import argparse
import json
import os
import re
import shlex
import subprocess
import tempfile
import tomllib
from pathlib import Path

EVENTS = ('SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop')
HOOK = Path(__file__).resolve().parent / 'bin/codex-hook'
CONFIG = Path(__file__).resolve().parent / 'codex/config.toml'


def update_config(current, preferences):
    """Merge top-level string preferences while preserving other TOML text."""
    settings = tomllib.loads(current)
    desired = tomllib.loads(preferences)
    if any(not isinstance(value, str) for value in desired.values()):
        raise ValueError('Codex preferences must be top-level strings')
    if all(settings.get(key) == value for key, value in desired.items()):
        return current
    table = re.search(r'^\s*\[', current, re.MULTILINE)
    boundary = table.start() if table else len(current)
    root, tables = current[:boundary], current[boundary:]
    for key in desired:
        root = re.sub(r'^[ \t]*' + re.escape(key) + r'[ \t]*=.*(?:\n|$)',
                      '', root, flags=re.MULTILINE)
    updated = preferences.rstrip() + '\n\n' + root + tables
    if tomllib.loads(updated) != {**settings, **desired}:
        raise ValueError('Cannot merge Codex preferences without changing other settings')
    return updated


def install_config(home):
    path = home / 'config.toml'
    current = path.read_text() if path.exists() else ''
    updated = update_config(current, CONFIG.read_text())
    if updated != current:
        home.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode='w', dir=home, delete=False) as file:
            tmp = Path(file.name)
            try:
                file.write(updated)
                file.flush()
                tmp.chmod(path.stat().st_mode if path.exists() else 0o600)
                tmp.replace(path)
            finally:
                tmp.unlink(missing_ok=True)


def add_hooks(settings, command):
    hooks = dict(settings.get('hooks', {}))
    for event in EVENTS:
        groups = list(hooks.get(event, []))
        if not any(h.get('command') == command
                   for g in groups for h in g.get('hooks', [])):
            groups.append({'hooks': [{'type': 'command', 'command': command, 'timeout': 10}]})
        hooks[event] = groups
    return {**settings, 'hooks': hooks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config-only', action='store_true',
                        help='install preferences without installing hooks')
    args = parser.parse_args()
    home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))).expanduser()
    install_config(home)
    if args.config_only:
        return
    subprocess.run([os.environ.get('HERDR_BIN_PATH', 'herdr'),
                    'integration', 'install', 'codex'], check=True)
    path = home / 'hooks.json'
    settings = json.loads(path.read_text())
    updated = add_hooks(settings, shlex.quote(str(HOOK)))
    if updated != settings:
        tmp = path.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(updated, indent=2) + '\n')
        tmp.chmod(path.stat().st_mode)
        tmp.replace(path)


if __name__ == '__main__':
    main()

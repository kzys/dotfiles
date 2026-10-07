#!/usr/bin/env python3
"""Install Herdr's Codex session hook and the dotfiles sidebar metadata hook."""

import json
import os
import shlex
import subprocess
from pathlib import Path

EVENTS = ('SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop')
HOOK = Path(__file__).resolve().parent / 'bin/codex-hook'


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
    subprocess.run([os.environ.get('HERDR_BIN_PATH', 'herdr'),
                    'integration', 'install', 'codex'], check=True)
    home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))).expanduser()
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

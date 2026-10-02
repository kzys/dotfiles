#!/usr/bin/env python3
"""Point Claude Code's status line at bin/claude-statusline and its
hooks at bin/claude-hook.

~/.claude/settings.json also holds settings Claude Code writes itself, so
it can't be a symlink into this repository like the other config files.
This adds these settings there instead, leaving the rest alone.
"""

import json
import os
import pathlib
import sys

SETTINGS = pathlib.Path.home() / '.claude' / 'settings.json'
STATUSLINE = pathlib.Path(__file__).resolve().parent / 'bin' / 'claude-statusline'
HOOK = pathlib.Path(__file__).resolve().parent / 'bin' / 'claude-hook'

# Events claude-hook handles.
HOOK_EVENTS = ['SessionStart']

# Hooks claude-hook replaces: Herdr's bundled Claude hook, which reports
# background sessions to the pane that started them, and claude-hook's
# old name.
REPLACED_HOOKS = ['herdr-agent-state.sh', 'claude-herdr-session']

# The status line shows countdowns, so rerun it while the session is
# idle too.
REFRESH_SECONDS = 60


def update(settings, command):
    """settings with the status line running command and rerun
    periodically. Raises ValueError rather than replace a status line set
    to something else."""
    have = settings.get('statusLine')
    if have is not None and os.path.expanduser(have.get('command', '')) != command:
        raise ValueError(f'statusLine already runs {have.get("command")!r}')
    if have is None:
        have = {'type': 'command', 'command': command}
    if 'refreshInterval' in have:
        return settings
    return {**settings, 'statusLine': {**have, 'refreshInterval': REFRESH_SECONDS}}


def runs(group, command):
    """Whether hook group runs command."""
    return any(os.path.expanduser(h.get('command', '')) == command
               for h in group.get('hooks', []))


def replaced(hook):
    """Whether claude-hook replaces hook."""
    return any(name in hook.get('command', '') for name in REPLACED_HOOKS)


def add_hooks(settings, command):
    """settings with command hooked to HOOK_EVENTS, in place of the hooks
    it replaces."""
    hooks = dict(settings.get('hooks', {}))
    for event in HOOK_EVENTS:
        groups = []
        for g in hooks.get(event, []):
            kept = [h for h in g.get('hooks', []) if not replaced(h)]
            if kept:
                groups.append({**g, 'hooks': kept})
        if not any(runs(g, command) for g in groups):
            groups.append({'hooks': [{'type': 'command', 'command': command}]})
        hooks[event] = groups
    if hooks == settings.get('hooks'):
        return settings
    return {**settings, 'hooks': hooks}


def main():
    try:
        with open(SETTINGS, encoding='utf-8') as f:
            settings = json.load(f)
    except FileNotFoundError:
        settings = {}

    try:
        updated = add_hooks(update(settings, str(STATUSLINE)), str(HOOK))
    except ValueError as e:
        sys.exit(f'{SETTINGS}: {e}')
    if updated == settings:
        return

    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS, 'w', encoding='utf-8') as f:
        json.dump(updated, f, indent=2, ensure_ascii=False)
        f.write('\n')


if __name__ == '__main__':
    main()

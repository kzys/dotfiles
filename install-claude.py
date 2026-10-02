#!/usr/bin/env python3
"""Point Claude Code's status line at bin/claude-statusline and its
hooks at bin/claude-hook, and drop entries for deleted directories from
~/.claude.json.

~/.claude/settings.json also holds settings Claude Code writes itself, so
it can't be a symlink into this repository like the other config files.
This adds these settings there instead, leaving the rest alone.
"""

import json
import os
import pathlib
import sys

SETTINGS = pathlib.Path.home() / '.claude' / 'settings.json'
STATE = pathlib.Path.home() / '.claude.json'
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


def gone(path):
    """Whether directory path was deleted. A missing path whose nearest
    existing ancestor is empty may be under an unmounted mount point, and
    one that can't be checked may still be there, so neither counts."""
    try:
        os.lstat(path)
        return False
    except FileNotFoundError:
        pass
    except OSError:
        return False
    parent = os.path.dirname(path)
    while True:
        try:
            return bool(os.listdir(parent))
        except FileNotFoundError:
            parent = os.path.dirname(parent)
        except OSError:
            return False


def prune_projects(state, homes, gone=gone):
    """state without the projects under any of homes whose directories
    are gone. Projects elsewhere may be on a drive that is only
    unmounted."""
    if not isinstance(state, dict) or not isinstance(state.get('projects'), dict):
        return state
    projects = state['projects']
    kept = {path: project for path, project in projects.items()
            if not path.startswith(tuple(f'{h}/' for h in homes)) or not gone(path)}
    if len(kept) == len(projects):
        return state
    return {**state, 'projects': kept}


def load(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save(path, data):
    """Writes data to path, or the file it links to, through a temporary
    file, so that a reader never sees it half written."""
    path = pathlib.Path(os.path.realpath(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')
    if path.exists():
        os.chmod(tmp, path.stat().st_mode)
    os.replace(tmp, path)


def main():
    settings = load(SETTINGS)
    try:
        updated = add_hooks(update(settings, str(STATUSLINE)), str(HOOK))
    except ValueError as e:
        sys.exit(f'{SETTINGS}: {e}')
    if updated != settings:
        save(SETTINGS, updated)

    # Claude Code rewrites this file while it runs, so read it as late
    # and write it as soon as possible. Pruning is only cleanup, so a
    # file it can't read is skipped rather than stopping the install.
    try:
        state = load(STATE)
    except (OSError, ValueError) as e:
        print(f'{STATE}: not pruned: {e}', file=sys.stderr)
        return
    home = str(pathlib.Path.home()).rstrip('/')
    pruned = prune_projects(state, {home, os.path.realpath(home)})
    if pruned is not state:
        save(STATE, pruned)


if __name__ == '__main__':
    main()

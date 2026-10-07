"""Shared agent selection and read-only Codex session discovery."""

import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path


def agent():
    value = os.environ.get('HERDR_AGENT', 'claude')
    if value not in ('claude', 'codex'):
        raise SystemExit('HERDR_AGENT must be claude or codex')
    return value


def codex_home():
    return Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))).expanduser()


def codex_sessions():
    """Newest main sessions, excluding archived sessions and subagents.

    Prefer the read-only state database, which also covers paginated history.
    Older installations without a state database use rollout session metadata.
    """
    home = codex_home()
    databases = sorted(home.glob('state_*.sqlite'),
                       key=lambda p: int(p.stem.split('_')[-1]), reverse=True)
    for path in databases:
        try:
            with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
                db.row_factory = sqlite3.Row
                rows = db.execute('SELECT * FROM threads WHERE archived = 0 '
                                  'ORDER BY updated_at DESC').fetchall()
            return [dict(r) for r in rows
                    if not r['source'].startswith(('{', 'subagent'))]
        except sqlite3.Error:
            continue
    names = {}
    try:
        for line in (home / 'session_index.jsonl').read_text().splitlines():
            try:
                item = json.loads(line)
                names[item['id']] = item.get('thread_name', '')
            except (ValueError, KeyError, TypeError):
                continue
    except OSError:
        pass
    sessions = []
    for path in (home / 'sessions').rglob('*.jsonl'):
        try:
            with path.open() as f:
                record = json.loads(f.readline())
            meta = record.get('payload', {})
            if record.get('type') != 'session_meta' or not isinstance(meta.get('source'), str):
                continue
            sid = meta.get('id') or meta.get('session_id')
            if sid and meta.get('cwd'):
                sessions.append({**meta, 'id': sid, 'title': names.get(sid, ''),
                                 'rollout_path': str(path),
                                 'updated_at': path.stat().st_mtime})
        except (OSError, ValueError):
            continue
    return sorted(sessions, key=lambda s: s['updated_at'], reverse=True)


def codex_context(path):
    """Latest current context usage in legacy rollouts, when available."""
    try:
        with Path(path).open('rb') as f:
            f.seek(max(0, f.seek(0, 2) - 262144))
            lines = f.read().splitlines()
        for line in reversed(lines):
            try:
                record = json.loads(line)
            except ValueError:
                continue
            payload = record.get('payload', {})
            if payload.get('type') != 'token_count':
                continue
            info = payload.get('info') or {}
            window = info.get('model_context_window')
            used = (info.get('last_token_usage') or {}).get('total_tokens')
            if window and used is not None:
                return min(100, int(used * 100 / window))
    except OSError:
        pass
    return None

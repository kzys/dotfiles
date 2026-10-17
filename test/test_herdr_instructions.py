from datetime import UTC, datetime
from pathlib import Path

from herdr_project.instructions import instructions, project_dir

ROOT = Path(__file__).resolve().parent.parent


def test_instructions_fill_in_the_session():
    text = instructions('/p/x', ROOT, datetime(2026, 10, 16, 21, 5, tzinfo=UTC))
    assert '`/p/x`' in text
    assert '2026-10-16 21:05 UTC' in text
    assert f'`{ROOT}`' in text
    assert '$PWD' not in text and '$start' not in text and '$dotfiles' not in text


def test_project_dir():
    assert project_dir('/h/project/a/repo/sub', '/h/project') == Path('/h/project/a')
    assert project_dir('/h/project/a', '/h/project') == Path('/h/project/a')
    assert project_dir('/h/project', '/h/project') is None
    assert project_dir('/h/other', '/h/project') is None

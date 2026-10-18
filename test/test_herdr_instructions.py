from datetime import UTC, datetime
from pathlib import Path

from herdr_project.instructions import instructions, new_project, project_dir, start_in

ROOT = Path(__file__).resolve().parent.parent


def test_instructions_fill_in_the_session():
    text = instructions('/p/x', ROOT, datetime(2026, 10, 16, 21, 5, tzinfo=UTC))
    assert '`/p/x`' in text
    assert '2026-10-16 21:05 UTC' in text
    assert f'`{ROOT}/PROJECT.md`' in text
    assert '$PWD' not in text and '$start' not in text and '$dotfiles' not in text


def test_project_dir():
    assert project_dir('/h/project/a/repo/sub', '/h/project') == Path('/h/project/a')
    assert project_dir('/h/project/a', '/h/project') == Path('/h/project/a')
    assert project_dir('/h/project', '/h/project') is None
    assert project_dir('/h/other', '/h/project') is None


def test_starts_new_sessions_outside_projects_in_a_new_one():
    projects, home = '/h/project', '/h'
    # A new session in a checkout gets a project, and works in the checkout.
    assert start_in('/h/repos/org/app', projects, home, []) == (None, Path('/h/repos/org/app'))
    # From home or ~/project itself, there is nothing in particular to
    # work in.
    assert start_in('/h', projects, home, []) == (None, None)
    assert start_in('/h/project', projects, home, []) == (None, None)
    # One in a project stays there.
    assert start_in('/h/project/a/app', projects, home, []) == (Path('/h/project/a/app'), None)
    # Anything but a new session, such as resuming one, which the agent
    # finds where it ran, or asking for help, stays put.
    for argv in (['--resume', 'id'], ['--resume=id'], ['-c', 'model=o3'], ['resume'], ['--help']):
        assert start_in('/h/repos/org/app', projects, home, argv) == (
            Path('/h/repos/org/app'), None)


def test_makes_new_projects_named_for_the_day(tmp_path):
    made = new_project(tmp_path / 'project', datetime(2026, 10, 18, 9, 0, tzinfo=UTC))
    assert made.is_dir()
    assert made.parent == tmp_path / 'project'
    assert made.name.startswith('20261018-')
    assert new_project(tmp_path / 'project', datetime(2026, 10, 18, tzinfo=UTC)) != made

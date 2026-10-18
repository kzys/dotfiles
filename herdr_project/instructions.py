"""The instructions agents get for working in a project."""

import tempfile
from pathlib import Path


def instructions(directory, dotfiles, now):
    """Returns the instructions in PROJECT.md of the dotfiles checkout,
    followed by those in its work/PROJECT.md if it has it, filling
    in the project's directory, now as the session's start time and the
    checkout's directory. work/ is gitignored, so it can hold rules that
    must stay private."""
    dotfiles = Path(dotfiles)
    text = (dotfiles / "PROJECT.md").read_text()
    try:
        text += "\n" + (dotfiles / "work/PROJECT.md").read_text()
    except OSError:
        pass
    start = now.strftime("%Y-%m-%d %H:%M %Z")
    return (text.replace("$PWD", str(directory)).replace("$start", start)
            .replace("$dotfiles", str(dotfiles)))


def project_dir(cwd, projects):
    """Returns the project directory directly under projects that holds
    cwd, or None if cwd isn't in one. Symlinks in either path don't
    matter."""
    try:
        parts = Path(cwd).resolve().relative_to(Path(projects).resolve()).parts
    except ValueError:
        return None
    return Path(projects) / parts[0] if parts else None


def new_project(projects, now):
    """Creates a new project directory under projects, named for the date
    of now, and returns it."""
    Path(projects).mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=now.strftime("%Y%m%d-"), dir=projects))


def start_in(cwd, projects, home, argv):
    """Returns where an agent started in cwd with argv runs, as the
    directory, or None for a new project under projects, and the
    directory it was started from, which it should also work in, or
    None. Only a new session, started with no arguments, outside a
    project gets one; anything else, such as resuming a session, which
    the agent finds where it ran, stays in cwd. It works in cwd unless
    that is home or projects itself, where nothing in particular is."""
    if argv or project_dir(cwd, projects):
        return Path(cwd), None
    plain = {Path(home).resolve(), Path(projects).resolve()}
    return None, (None if Path(cwd).resolve() in plain else Path(cwd))

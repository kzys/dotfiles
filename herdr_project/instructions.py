"""The instructions agents get for working in a project."""

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

"""What the watcher found waiting on the user across projects.
herdr-project-web adds what the agents' notes say to it."""

from dataclasses import dataclass

from herdr_project.state import load_state, save_state


def read_sources(path):
    """Returns the inbox items the watcher kept in path by source, or {}
    if it hasn't run."""
    sources = load_state(path)
    return sources if isinstance(sources, dict) else {}


def write_sources(path, sources):
    """Keeps the inbox items in sources, by source, in path, replacing
    it whole so that readers never see half of it."""
    save_state(path, sources)


@dataclass(frozen=True)
class Owner:
    """Who works on something the watcher found: the project directory,
    the worktree in it, if known, and the role of the agent, if known."""
    project: str
    dir: str | None = None
    role: str | None = None


def item(found, mark, text):
    """Returns an inbox item for text with mark, belonging to the Owner
    found, or to no project if found is None."""
    return {"project": found.project if found else None,
            "role": found.role if found else None, "mark": mark, "text": text}

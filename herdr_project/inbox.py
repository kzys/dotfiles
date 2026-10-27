"""What the watcher found waiting on the user across projects.
herdr-project-web adds what the agents' notes say to it."""

from dataclasses import dataclass


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

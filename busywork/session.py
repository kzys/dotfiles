"""What the window shows about a session, whichever tool it came from."""

from dataclasses import dataclass, field


@dataclass
class Transcript:
    """Details of a session's conversation; None where unknown."""

    model: str = None    # of the last assistant message
    context: int = None  # tokens in the last request: everything the model read
    window: int = None   # the model's limit
    prompt: str = None   # the last one
    last: str = None     # ISO-8601 time of the last activity
    branch: str = None   # git branch


@dataclass
class Session:
    """One row of the window."""

    id: str              # unique across sources
    name: str = ""
    cwd: str = ""        # working directory
    state: str = ""      # "working", "blocked", "done" or "failed"; "" when
                         # the tool doesn't say, as for an interactive session
    status: str = ""     # "busy" or "waiting" for a session that reports
                         # only that
    pid: int = None      # set when the session is a live process
    detail: str = ""     # what the session says it is doing, if it does
    transcript: Transcript = field(default_factory=Transcript)

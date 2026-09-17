"""What the window lists sessions from."""


class Source:
    """A tool whose sessions the window shows.

    A tool that isn't installed or running yields no sessions and no
    version; anything else that goes wrong raises, and the window shows it.
    """

    name = ""

    def version(self):
        """The tool's version, or "" if it isn't available."""
        raise NotImplementedError

    def sessions(self, show_all):
        """A Session for every session, or only the ones still going when
        show_all is false."""
        raise NotImplementedError

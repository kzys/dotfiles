"""What the window lists sessions from."""


class Source:
    """A tool whose sessions the window shows.

    sessions() returns one dict per session with these keys, all optional
    but "id", which must be unique across sources:

      id          row key
      name        what the session is called
      cwd         its working directory
      state       "working", "blocked", "done" or "failed"; "" or missing
                  when the tool doesn't say, as for an interactive session
      status      "busy" or "waiting" for a session that reports only that
      pid         set when the session is a live process
      transcript  details of the conversation: "model", "context" (tokens
                  in the last request), "window" (the model's limit),
                  "prompt" (the last one), "last" (ISO-8601 time of the
                  last activity) and "branch"
      job         what a background job reports about itself: "detail", its
                  one-line summary of what it is doing

    A tool that isn't installed or running yields no sessions and no
    version; anything else that goes wrong raises, and the window shows it.
    """

    name = ""

    def version(self):
        """The tool's version, or "" if it isn't available."""
        raise NotImplementedError

    def sessions(self, show_all):
        """Rows for every session, or only the ones still going when
        show_all is false."""
        raise NotImplementedError

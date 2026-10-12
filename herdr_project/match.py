"""Filtering picker rows by a query, and measuring them for the terminal."""

import unicodedata


def columns(text):
    """Returns how many terminal columns text takes."""
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in text)


def clip(text, width):
    """Returns the longest prefix of text that fits in width columns."""
    used = 0
    for i, c in enumerate(text):
        used += columns(c)
        if used > width:
            return text[:i]
    return text


def found(word, text):
    """Returns where word appears in text, or -1. A word with uppercase
    letters matches case, and one without ignores it."""
    if word == word.lower():
        # Lowercasing a few characters, such as "İ", changes their length,
        # which would move the index away from the match in text.
        text = "".join(c.lower() if len(c.lower()) == 1 else c for c in text)
    return text.find(word)


def spans(words, text):
    """Returns the (start, end) of each word that appears in text."""
    return [
        (i, i + len(w)) for w in words if w and (i := found(w, text)) >= 0
    ]


def visible(rows, query):
    """Returns the indices of rows, (kind, directory, session, text)
    each, that query matches. Every word in query must appear in the
    row's text or, for a session, in its project's text. A project is
    shown when any of its sessions is."""
    words = query.split()
    shown = []
    group = None
    for i, (kind, _, _, text) in enumerate(rows):
        if kind == "session":
            if all(found(w, rows[group][3] + "\n" + text) >= 0 for w in words):
                if group not in shown:
                    shown.append(group)
                shown.append(i)
            continue
        group = i
        if all(found(w, text) >= 0 for w in words):
            shown.append(i)
    return shown

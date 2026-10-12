"""The curses screen that lets the user pick a row."""

import curses
import locale
import os
import sys
import threading

from .match import clip, columns, spans, visible

# What the line below the list says Enter does, by kind of row.
HINT = {
    "new": "enter: start a new session in a new project",
    "project": "enter: start a new session in this project",
    "running": "enter: switch to this running session",
    "session": "enter: resume this session",
}


def hint(row):
    """Returns what the line below the list says Enter does on row."""
    kind, _, _, text = row
    if kind == "session" and "●" in text:
        return HINT["running"]
    return HINT[kind]


def put(win, y, x, text, attr=0):
    """Writes text at y, x, clipped to the window. Writing to the last
    cell of a window raises, so errors are ignored."""
    height, width = win.getmaxyx()
    if y >= height or x >= width:
        return x
    text = clip(text, width - x)
    try:
        win.addstr(y, x, text, attr)
    except curses.error:
        pass
    return x + columns(text)


class Loading:
    """Rows read from lines, tab-separated, in a background thread."""

    def __init__(self, lines):
        self.rows = []
        self.done = False
        self.error = None
        self.thread = threading.Thread(target=self.read, args=(lines,), daemon=True)
        self.thread.start()

    def read(self, lines):
        """Appends a row for each of lines, then marks the rows done.
        An error stops reading, keeping the rows read so far, and is
        kept in error."""
        try:
            for line in lines:
                self.rows.append(line.split("\t", 3))
        except Exception as e:  # noqa: BLE001 - raised again by pick.
            self.error = e
        finally:
            self.done = True

    def wait(self):
        """Waits until all rows are read."""
        self.thread.join()


def follow(shown, cursor, new):
    """Returns where the cursor goes in the rows new shows, so that it
    stays on the row it highlights in shown, or else stays put."""
    current = shown[cursor] if 0 <= cursor < len(shown) else None
    return new.index(current) if current in new else cursor


def run(screen, loading, notes):
    """Lets the user pick one of the rows of loading on screen, showing
    them as they arrive and notes(*row[:3]) for the highlighted row
    below them. Returns its index, or
    None if the user quits with Esc or ctrl-g. Up, down, ctrl-p, ctrl-n,
    PgUp and PgDn move; shift-up and shift-down scroll the preview."""
    if curses.has_colors():
        curses.use_default_colors()
        curses.init_pair(1, curses.COLOR_YELLOW, -1)
        curses.init_pair(2, curses.COLOR_GREEN, -1)
        curses.init_pair(3, curses.COLOR_BLUE, -1)

    def color(n):
        """Returns color pair n, or nothing if the terminal has no colors."""
        return curses.color_pair(n) if curses.has_colors() else 0

    query = ""
    # Notes by row, read once: the picker is short-lived, so they can't
    # go stale for long.
    previews = {}
    rows = loading.rows
    loaded = len(rows)
    shown = visible(rows[:loaded], query)
    cursor = top = scroll = 0
    while True:
        # Read whether loading is done before the rows, so the last rows
        # are drawn before waiting for keys without a timeout.
        done = loading.done
        if len(rows) != loaded:
            loaded = len(rows)
            new = visible(rows[:loaded], query)
            cursor = follow(shown, cursor, new)
            shown = new
        height, width = screen.getmaxyx()
        lines = max(1, (height - 3) // 2)
        cursor = max(0, min(cursor, len(shown) - 1))
        top = min(max(top, cursor - lines + 1), cursor)
        words = query.split()

        screen.erase()
        for y, i in enumerate(shown[top:top + lines], start=1):
            kind, _, _, text = rows[i]
            selected = top + y - 1 == cursor
            base = curses.A_BOLD if kind != "session" else 0
            if selected:
                put(screen, y, 0, ">", color(3) | curses.A_BOLD)
            hits = spans(words, text)
            x = 2
            for j, c in enumerate(text):
                attr = base
                if any(a <= j < b for a, b in hits):
                    attr |= color(1) | curses.A_BOLD
                elif c == "●":
                    attr |= color(2)
                moved = put(screen, y, x, c, attr)
                if moved == x:
                    break
                x = moved
        count = f"  {len(shown)}/{loaded}{'' if done else '…'}  "
        put(screen, lines + 1, 0, count, curses.A_DIM)
        if shown:
            put(screen, lines + 1, columns(count), hint(rows[shown[cursor]]), curses.A_DIM)
        rule = lines + 2
        put(screen, rule, 0, "─" * width, color(3))
        text = []
        if shown:
            if shown[cursor] not in previews:
                previews[shown[cursor]] = notes(*rows[shown[cursor]][:3]).splitlines()
            text = previews[shown[cursor]]
        scroll = min(scroll, max(0, len(text) - 1))
        for y, line in enumerate(text[scroll:], start=rule + 1):
            if y >= height:
                break
            put(screen, y, 0, line.expandtabs())
        put(screen, 0, 0, "project> ", color(3) | curses.A_BOLD)
        put(screen, 0, 9, query)
        screen.move(0, min(width - 1, 9 + columns(query)))
        screen.refresh()

        # Wake up now and then to show rows that arrive meanwhile.
        screen.timeout(-1 if done else 100)
        try:
            key = screen.get_wch()
        except curses.error:
            continue
        if key == "\x1b" and pending(screen):
            continue
        moves = {
            curses.KEY_UP: -1, "\x10": -1, curses.KEY_DOWN: 1, "\x0e": 1,
            curses.KEY_PPAGE: -lines, curses.KEY_NPAGE: lines,
        }
        edited = query
        if key in ("\x1b", "\x07"):
            return None
        elif key in ("\n", "\r", curses.KEY_ENTER):
            return shown[cursor] if shown else None
        elif key in moves:
            cursor = max(0, min(cursor + moves[key], len(shown) - 1))
            scroll = 0
        elif key == curses.KEY_SR:
            scroll = max(0, scroll - 1)
        elif key == curses.KEY_SF:
            scroll += 1
        elif key in (curses.KEY_BACKSPACE, "\x7f", "\x08"):
            edited = query[:-1]
        elif key == "\x15":
            edited = ""
        elif key == "\x17":
            edited = query.rstrip()
            edited = edited[: edited.rfind(" ") + 1]
        elif isinstance(key, str) and key.isprintable():
            edited = query + key
        if edited != query:
            query = edited
            shown = visible(rows[:loaded], query)
            cursor = top = scroll = 0


def pending(screen):
    """Reads and drops any keys already waiting on screen, the rest of an
    escape sequence curses didn't recognize. Returns whether there were
    any."""
    screen.nodelay(True)
    try:
        dropped = False
        while True:
            try:
                screen.get_wch()
            except curses.error:
                return dropped
            dropped = True
    finally:
        screen.nodelay(False)


def pick(lines, notes):
    """Returns the fields of the line the user picks, or None if the user
    quits, including with ctrl-c. notes(kind, directory, session) returns
    the text to show below the list for a line."""
    loading = Loading(lines)
    locale.setlocale(locale.LC_ALL, "")
    os.environ.setdefault("ESCDELAY", "25")
    try:
        i = curses.wrapper(run, loading, notes)
    except KeyboardInterrupt:
        return None
    if loading.error and i is None:
        raise loading.error
    if loading.error:
        print(f"Not all projects loaded: {loading.error!r}", file=sys.stderr)
    return None if i is None else loading.rows[i][:3]

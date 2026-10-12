"""The curses screen that lets the user pick a row."""

import curses
import locale
import os
from pathlib import Path

from .match import clip, columns, spans, visible

# What the line below the list says Enter does, by kind of row.
HINT = {
    "new": "enter: start a new session in a new project",
    "project": "enter: start a new session in this project",
    "running": "enter: switch to this running session",
    "session": "enter: resume this session",
}


def preview(directory):
    """Returns the notes in directory: README.md, then AGENT-*.md."""
    if not directory:
        return ""
    d = Path(directory)
    texts = []
    for f in [d / "README.md", *sorted(d.glob("AGENT-*.md"))]:
        try:
            texts.append(f.read_text(errors="replace"))
        except OSError:
            pass
    return "".join(texts)


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


def run(screen, rows):
    """Lets the user pick one of rows on screen. Returns its index, or
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
    shown = visible(rows, query)
    cursor = top = scroll = 0
    while True:
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
        count = f"  {len(shown)}/{len(rows)}  "
        put(screen, lines + 1, 0, count, curses.A_DIM)
        if shown:
            put(screen, lines + 1, columns(count), hint(rows[shown[cursor]]), curses.A_DIM)
        rule = lines + 2
        put(screen, rule, 0, "─" * width, color(3))
        notes = preview(rows[shown[cursor]][1]).splitlines() if shown else []
        scroll = min(scroll, max(0, len(notes) - 1))
        for y, line in enumerate(notes[scroll:], start=rule + 1):
            if y >= height:
                break
            put(screen, y, 0, line.expandtabs())
        put(screen, 0, 0, "project> ", color(3) | curses.A_BOLD)
        put(screen, 0, 9, query)
        screen.move(0, min(width - 1, 9 + columns(query)))
        screen.refresh()

        key = screen.get_wch()
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
            cursor += moves[key]
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
            shown = visible(rows, query)
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


def pick(lines):
    """Returns the fields of the line the user picks, or None if the user
    quits, including with ctrl-c."""
    rows = [line.split("\t", 3) for line in lines]
    locale.setlocale(locale.LC_ALL, "")
    os.environ.setdefault("ESCDELAY", "25")
    try:
        i = curses.wrapper(run, rows)
    except KeyboardInterrupt:
        return None
    return None if i is None else rows[i][:3]

// The project picker's screen, as functions of its state: matching rows,
// handling keys and drawing, with no terminal involved.

import type { Row } from "./rows.ts";

/** Returns how many terminal columns the character c takes. */
function width(c: string): number {
  if (/\p{Emoji_Presentation}/u.test(c)) return 2;
  const n = c.codePointAt(0)!;
  const wide = (n >= 0x1100 && n <= 0x115f) || (n >= 0x2e80 && n <= 0xa4cf) || (n >= 0xac00 && n <= 0xd7a3)
    || (n >= 0xf900 && n <= 0xfaff) || (n >= 0xfe30 && n <= 0xfe6f) || (n >= 0xff00 && n <= 0xff60)
    || (n >= 0xffe0 && n <= 0xffe6) || (n >= 0x1f300 && n <= 0x1f64f) || (n >= 0x1f900 && n <= 0x1f9ff)
    || (n >= 0x20000 && n <= 0x3fffd);
  return wide ? 2 : 1;
}

/** Returns how many terminal columns text takes. */
export const columns = (text: string) => [...text].reduce((sum, c) => sum + width(c), 0);

/** Returns the longest prefix of text that fits in limit columns. */
export function clip(text: string, limit: number): string {
  let used = 0;
  let out = "";
  for (const c of text) {
    used += width(c);
    if (used > limit) break;
    out += c;
  }
  return out;
}

/** Returns where word appears in text, or -1. A word with uppercase
 * letters matches case, and one without ignores it. */
export function found(word: string, text: string): number {
  if (word !== word.toLowerCase()) return text.indexOf(word);
  // Lowercasing a few characters, such as "İ", changes their length, which
  // would move the index away from the match in text.
  return [...text].map((c) => (c.toLowerCase().length === c.length ? c.toLowerCase() : c)).join("").indexOf(word);
}

/** Returns the [start, end) of each of words that appears in text. */
export function spans(words: string[], text: string): [number, number][] {
  return words.flatMap((w) => {
    const at = found(w, text);
    return at >= 0 ? [[at, at + w.length] as [number, number]] : [];
  });
}

/** Returns the indices of rows that query matches. Every word in query
 * must appear in the row's text or, for a session, in its project's text.
 * A project is shown when any of its sessions is. */
export function visible(rows: Row[], query: string): number[] {
  const words = query.split(/\s+/).filter(Boolean);
  const shown: number[] = [];
  let group = -1;
  rows.forEach(([kind, , , text], i) => {
    if (kind === "session") {
      if (words.every((w) => found(w, `${rows[group]?.[3] ?? ""}\n${text}`) >= 0)) {
        if (group >= 0 && !shown.includes(group)) shown.push(group);
        shown.push(i);
      }
      return;
    }
    group = i;
    if (words.every((w) => found(w, text) >= 0)) shown.push(i);
  });
  return shown;
}

// What the line below the list says Enter does, by kind of row, with the
// selected agent.
const HINT: Record<string, string> = {
  new: "enter: start a new {} session in a new project",
  project: "enter: start a new {} session in this project",
  running: "enter: switch to this running session",
  session: "enter: resume this session",
  unsaved: "enter: start a new {} session for this",
};

/** Returns what the line below the list says Enter does on row. A session
 * row without a session, as for an inbox item of a project with none
 * saved, starts a new one. */
export function hint([kind, , sid, text]: Row, agent: string): string {
  if (kind === "session" && !sid) return HINT.unsaved.replace("{}", agent);
  if (kind === "session" && text.includes("●")) return HINT.running;
  return (HINT[kind] ?? "").replace("{}", agent);
}

/** Splits what the terminal sent into keys: names like up, ctrl-n and
 * enter, or the characters typed. Sequences it doesn't know are dropped. */
export function parseKeys(data: string): string[] {
  const named: [string, string][] = [
    ["\x1b[1;2A", "shift-up"], ["\x1b[1;2B", "shift-down"], ["\x1b[5~", "pageup"], ["\x1b[6~", "pagedown"],
    ["\x1b[A", "up"], ["\x1b[B", "down"], ["\x1b[C", "right"], ["\x1b[D", "left"],
    ["\x1bOA", "up"], ["\x1bOB", "down"], ["\x1bOC", "right"], ["\x1bOD", "left"],
  ];
  const keys: string[] = [];
  let rest = data;
  while (rest) {
    const known = named.find(([seq]) => rest.startsWith(seq));
    if (known) {
      keys.push(known[1]);
      rest = rest.slice(known[0].length);
      continue;
    }
    // Other sequences, and Alt with a key, which quit the picker otherwise.
    const unknown = /^\x1b([[O][0-9;]*[A-Za-z~]|[^\x1b])/.exec(rest);
    if (unknown) {
      rest = rest.slice(unknown[0].length);
      continue;
    }
    const c = [...rest][0];
    rest = rest.slice(c.length);
    const code = c.codePointAt(0)!;
    if (c === "\x1b") keys.push("esc");
    else if (c === "\r" || c === "\n") keys.push("enter");
    else if (c === "\x7f" || c === "\x08") keys.push("backspace");
    else if (code < 32) keys.push(`ctrl-${String.fromCharCode(code + 96)}`);
    else keys.push(c);
  }
  return keys;
}

export type Picker = {
  query: string; shown: number[]; cursor: number; top: number; scroll: number; agent: string;
  // What happened: still picking, or the user picked or quit.
  done: "no" | "picked" | "quit";
};

/** Returns the picker's state before any key, over rows. */
export const start = (rows: Row[], agents: readonly string[]): Picker => ({
  query: "", shown: visible(rows, ""), cursor: 0, top: 0, scroll: 0, agent: agents[0], done: "no",
});

/** Returns how many rows of the list fit in height. */
export const listLines = (height: number) => Math.max(1, Math.floor((height - 3) / 2));

/** Returns state after key. Up, down, ctrl-p, ctrl-n, page up and page
 * down move; left, right, ctrl-b and ctrl-f switch the agent; shift-up
 * and shift-down scroll the preview; Esc, ctrl-g and ctrl-c quit. */
export function press(state: Picker, key: string, rows: Row[], agents: readonly string[], lines: number): Picker {
  const move = (by: number) => ({ ...state, cursor: Math.max(0, Math.min(state.cursor + by, state.shown.length - 1)), scroll: 0 });
  const edit = (query: string) => ({ ...state, query, shown: visible(rows, query), cursor: 0, top: 0, scroll: 0 });
  const change = (by: number) => ({ ...state, agent: agents[(agents.indexOf(state.agent) + by + agents.length) % agents.length] });
  switch (key) {
    case "esc": case "ctrl-g": case "ctrl-c": return { ...state, done: "quit" };
    case "enter": return { ...state, done: state.shown.length ? "picked" : "quit" };
    case "up": case "ctrl-p": return move(-1);
    case "down": case "ctrl-n": return move(1);
    case "pageup": return move(-lines);
    case "pagedown": return move(lines);
    case "right": case "ctrl-f": return change(1);
    case "left": case "ctrl-b": return change(-1);
    case "shift-up": return { ...state, scroll: Math.max(0, state.scroll - 1) };
    case "shift-down": return { ...state, scroll: state.scroll + 1 };
    case "backspace": return edit([...state.query].slice(0, -1).join(""));
    case "ctrl-u": return edit("");
    case "ctrl-w": {
      const kept = state.query.trimEnd();
      return edit(kept.slice(0, kept.lastIndexOf(" ") + 1));
    }
    default: return [...key].length === 1 && key >= " " ? edit(state.query + key) : state;
  }
}

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const REVERSE = "\x1b[7m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const RESET = "\x1b[0m";

/** Returns text without control characters, which come from titles, notes
 * and messages the user didn't write and could drive the terminal. */
export const printable = (text: string) => text.replaceAll("\t", "    ").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

/** Returns text clipped to limit columns, with the parts matching words
 * and running marks in color, on top of base. */
function colored(text: string, words: string[], limit: number, base: string): string {
  const hits = spans(words, text);
  let out = base;
  let offset = 0;
  for (const c of clip(text, limit)) {
    const hit = hits.some(([a, b]) => a <= offset && offset < b);
    if (hit) out += `${YELLOW}${BOLD}${c}${RESET}${base}`;
    else if (c === "●") out += `${GREEN}${c}${RESET}${base}`;
    else out += c;
    offset += c.length;
  }
  return out + RESET;
}

/** Returns the screen for state as its lines, height of them at most and
 * each fitting in width columns, showing preview, the highlighted row's
 * notes, below the list. It also moves top to keep the cursor in view. */
export function draw(
  state: Picker, rows: Row[], agents: readonly string[], preview: string, height: number, screenWidth: number,
): string[] {
  const lines = listLines(height);
  state.top = Math.min(Math.max(state.top, state.cursor - lines + 1), state.cursor);
  const words = state.query.split(/\s+/).filter(Boolean);
  const out = [`${BLUE}${BOLD}project> ${RESET}${clip(state.query, screenWidth - 10)}`];
  for (const [n, i] of state.shown.slice(state.top, state.top + lines).entries()) {
    const [kind, , , text] = rows[i];
    const selected = state.top + n === state.cursor;
    const suffix = ` with ${agents.map((a) => ` ${a} `).join("")}`;
    const room = screenWidth - 2 - (kind === "new" ? columns(suffix) : 0);
    let line = `${selected ? `${BLUE}${BOLD}>${RESET}` : " "} `;
    line += colored(printable(text), words, Math.max(0, room), kind === "session" ? "" : BOLD);
    if (kind === "new" && room > 0) {
      line += ` with ${agents.map((a) => (a === state.agent ? `${REVERSE}${BOLD} ${a} ${RESET}` : `${DIM} ${a} ${RESET}`)).join("")}`;
    }
    out.push(line);
  }
  while (out.length <= lines) out.push("");
  const row = state.shown.length ? rows[state.shown[state.cursor]] : null;
  out.push(`${DIM}${clip(`  ${state.shown.length}/${rows.length}  ${row ? hint(row, state.agent) : ""}`, screenWidth)}${RESET}`);
  out.push(`${BLUE}${"─".repeat(screenWidth)}${RESET}`);
  const text = preview.split("\n");
  state.scroll = Math.min(state.scroll, Math.max(0, text.length - 1));
  for (const line of text.slice(state.scroll)) {
    if (out.length >= height) break;
    out.push(clip(printable(line), screenWidth));
  }
  return out.slice(0, height);
}

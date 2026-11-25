// Matching the picker's rows, as herdr-project-web's picker.ts does for the
// terminal picker, which this follows. A row is [kind, dir, session, text].

/** Returns where word appears in text, or -1. A word with uppercase
 * letters matches case, and one without ignores it. */
export function found(word, text) {
  if (word !== word.toLowerCase()) return text.indexOf(word);
  // Lowercasing a few characters, such as "İ", changes their length, which
  // would move the index away from the match in text.
  return [...text].map((c) => (c.toLowerCase().length === c.length ? c.toLowerCase() : c)).join("").indexOf(word);
}

/** Returns the words of query. */
export const words = (query) => query.split(/\s+/).filter(Boolean);

/** Returns the [start, end) of each of words that appears in text. */
export function spans(words, text) {
  return words.flatMap((w) => {
    const at = found(w, text);
    return at >= 0 ? [[at, at + w.length]] : [];
  });
}

/** Returns the indices of rows that query matches. Every word in query
 * must appear in the row's text or, for a session, in its project's text.
 * A project is shown when any of its sessions is. */
export function visible(rows, query) {
  const ws = words(query);
  const shown = [];
  let group = -1;
  rows.forEach(([kind, , , text], i) => {
    if (kind === "session") {
      if (ws.every((w) => found(w, `${rows[group]?.[3] ?? ""}\n${text}`) >= 0)) {
        if (group >= 0 && !shown.includes(group)) shown.push(group);
        shown.push(i);
      }
      return;
    }
    group = i;
    if (ws.every((w) => found(w, text) >= 0)) shown.push(i);
  });
  return shown;
}

// What Enter does, by kind of row, with the selected agent.
const HINT = {
  new: "Enter starts a new {} session in a new project",
  project: "Enter starts a new {} session in this project",
  running: "Enter switches to this running session",
  session: "Enter resumes this session",
  unsaved: "Enter starts a new {} session for this",
};

/** Returns what Enter does on row. A session row without a session, as for
 * an inbox item of a project with none saved, starts a new one. */
export function hint([kind, , sid, text], agent) {
  if (kind === "session" && !sid) return HINT.unsaved.replace("{}", agent);
  if (kind === "session" && text.includes("●")) return HINT.running;
  return (HINT[kind] ?? "").replace("{}", agent);
}

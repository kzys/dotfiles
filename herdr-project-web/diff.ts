// Reading git's unified diffs into files, hunks and lines for the page.

export type DiffLine = {
  kind: "add" | "del" | "ctx" | "note";
  text: string;
  // The line's numbers in the old and new file, where it has one.
  old: number | null;
  new: number | null;
};

export type Hunk = { header: string; lines: DiffLine[] };

export type FileDiff = {
  // The file's path before and after, null where it doesn't exist.
  from: string | null;
  to: string | null;
  status: "added" | "deleted" | "modified" | "renamed";
  binary: boolean;
  added: number;
  removed: number;
  hunks: Hunk[];
};

/** Returns path as git quotes it, unquoted: in double quotes with C
 * escapes, octal for bytes it won't print, or as is. */
export function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path;
  const bytes: number[] = [];
  const named: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };
  const body = path.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      bytes.push(...new TextEncoder().encode(c));
      continue;
    }
    const e = body[++i];
    if (/[0-7]/.test(e)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push(named[e] ?? e.charCodeAt(0));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Returns the path in a ---/+++ line's rest, without its a/ or b/
 * prefix, or null for /dev/null. */
function sidePath(rest: string): string | null {
  // Git ends the path with a tab when it has spaces.
  const p = unquote(rest.replace(/\t$/, ""));
  if (p === "/dev/null") return null;
  return p.replace(/^[ab]\//, "");
}

/** Returns the files in text, the output of git diff. */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    if (hunk && (oldLeft > 0 || newLeft > 0 || line.startsWith("\\"))) {
      const c = line[0];
      if (c === "\\") {
        hunk.lines.push({ kind: "note", text: line.slice(2), old: null, new: null });
        continue;
      }
      if (c === "+") {
        hunk.lines.push({ kind: "add", text: line.slice(1), old: null, new: newNo++ });
        file!.added++;
        newLeft--;
      } else if (c === "-") {
        hunk.lines.push({ kind: "del", text: line.slice(1), old: oldNo++, new: null });
        file!.removed++;
        oldLeft--;
      } else {
        hunk.lines.push({ kind: "ctx", text: line.slice(1), old: oldNo++, new: newNo++ });
        oldLeft--;
        newLeft--;
      }
      continue;
    }
    hunk = null;
    if (line.startsWith("diff --git ")) {
      // The header's paths are a fallback for diffs without ---/+++
      // lines, as for binary files; they split badly only with " b/" in
      // a path.
      const m = line.slice("diff --git ".length).match(/^("(?:[^"\\]|\\.)*"|.*?) ("(?:[^"\\]|\\.)*"|b\/.*)$/);
      const from = m ? unquote(m[1]).replace(/^a\//, "") : null;
      const to = m ? unquote(m[2]).replace(/^b\//, "") : null;
      file = { from, to, status: "modified", binary: false, added: 0, removed: 0, hunks: [] };
      files.push(file);
    } else if (!file) {
      continue;
    } else if (line.startsWith("new file mode")) {
      file.status = "added";
      file.from = null;
    } else if (line.startsWith("deleted file mode")) {
      file.status = "deleted";
      file.to = null;
    } else if (line.startsWith("rename from ")) {
      file.status = "renamed";
      file.from = unquote(line.slice("rename from ".length));
    } else if (line.startsWith("rename to ")) {
      file.to = unquote(line.slice("rename to ".length));
    } else if (line.startsWith("Binary files ")) {
      file.binary = true;
    } else if (line.startsWith("--- ")) {
      file.from = sidePath(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      file.to = sidePath(line.slice(4));
    } else {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!m) continue;
      oldNo = Number(m[1]);
      oldLeft = m[2] === undefined ? 1 : Number(m[2]);
      newNo = Number(m[3]);
      newLeft = m[4] === undefined ? 1 : Number(m[4]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
    }
  }
  return files;
}

/** Returns the path the page names file by: where it is now, or where
 * it was if deleted. */
export const filePath = (file: FileDiff) => file.to ?? file.from ?? "";

/** Returns hunk's lines as rows of a side-by-side view: the old file's
 * line on the left and the new file's on the right, with each run of
 * removed lines beside the added lines that follow it. git's notes go
 * on the side of the line before them. */
export function splitRows(hunk: Hunk): [DiffLine | null, DiffLine | null][] {
  const rows: [DiffLine | null, DiffLine | null][] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push([dels[i] ?? null, adds[i] ?? null]);
    dels = [];
    adds = [];
  };
  for (const l of hunk.lines) {
    if (l.kind === "ctx") {
      flush();
      rows.push([l, l]);
    } else if (l.kind === "del") {
      if (adds.length) flush();
      dels.push(l);
    } else if (l.kind === "add") {
      adds.push(l);
    } else if (adds.length) {
      adds.push(l);
    } else if (dels.length) {
      dels.push(l);
    } else {
      rows.push([l, l]);
    }
  }
  flush();
  return rows;
}

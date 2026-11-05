// Reading agents' saved sessions: Claude Code's transcripts under
// ~/.claude/projects, and Codex's state database and rollouts.

import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Returns where claude keeps the transcripts of the sessions in
 * directory, under .claude/projects in home, in a directory named after
 * the path. */
export function transcriptDir(directory: string, home = homedir()): string {
  return join(home, ".claude/projects", directory.replace(/[^a-zA-Z0-9]/g, "-"));
}

export type Transcript = { path: string; id: string; updatedAt: number };

/** Returns the transcripts of the sessions in directory, newest first.
 * updatedAt is in seconds. */
export function transcripts(directory: string, home = homedir()): Transcript[] {
  const dir = transcriptDir(directory, home);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(".jsonl")).flatMap((n) => {
    try {
      return [{ path: join(dir, n), id: n.slice(0, -".jsonl".length), updatedAt: statSync(join(dir, n)).mtimeMs / 1000 }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

// Claude appends a session's titles again as it goes, so they are near the
// end of its transcript.
const TAIL = 131072;
// Where a title is, and its key, in the order title prefers them.
const TITLES = [['"type":"custom-title"', "customTitle"], ['"type":"ai-title"', "aiTitle"]];

/** Returns the last bytes of the file at path, with its size. */
function tail(path: string, bytes: number): [string, number] {
  const fd = openSync(path, "r");
  try {
    const size = statSync(path).size;
    const buffer = Buffer.alloc(Math.min(size, bytes));
    readSync(fd, buffer, 0, buffer.length, size - buffer.length);
    return [buffer.toString("utf8"), size];
  } finally {
    closeSync(fd);
  }
}

/** Returns the last bytes of the file at path. */
export const tailOf = (path: string, bytes: number) => tail(path, bytes)[0];

/** Returns the title of the session in transcript: the one it was renamed
 * to, the one claude generated, or else its first prompt on one line, cut
 * to 60 characters. Returns "" if there is none. Reads only the last tail
 * bytes unless they have no title. */
export function title(transcript: string, bytes = TAIL): string {
  let [data, size] = tail(transcript, bytes);
  if (size > bytes && !TITLES.some(([marker]) => data.includes(marker))) data = readFileSync(transcript, "utf8");
  const field = (at: number, key: string) => {
    if (at < 0) return null;
    const end = data.indexOf("\n", at);
    try {
      return JSON.parse(data.slice(data.lastIndexOf("\n", at) + 1, end < 0 ? undefined : end))[key] ?? null;
    } catch {
      return null;
    }
  };
  for (const [marker, key] of TITLES) {
    const value = field(data.lastIndexOf(marker), key);
    if (value) return value;
  }
  const prompt = field(data.indexOf('"lastPrompt"'), "lastPrompt") ?? "";
  return String(prompt).split(/\s+/).filter(Boolean).join(" ").slice(0, 60);
}

// How an agent reports its role, which names its notes file, to Herdr. Any
// command with this text counts, even one that only greps for it; a wrong
// role at worst shows the wrong notes, or all of them.
const REPORT = /report-metadata\s+"?\$\{?HERDR_PANE_ID\}?"?.*--token role=([A-Za-z0-9_-]+)/;

/** Returns the role the session in transcript last reported for its own
 * pane, or null. */
export function reportedRole(transcript: string): string | null {
  let text: string;
  try {
    text = readFileSync(transcript, "utf8");
  } catch {
    return null;
  }
  let role: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes("report-metadata")) continue;
    let content: unknown;
    try {
      content = JSON.parse(line).message.content;
    } catch {
      continue;
    }
    for (const part of Array.isArray(content) ? content : []) {
      if (part?.type !== "tool_use") continue;
      const found = REPORT.exec(String(part.input?.command ?? ""));
      if (found) role = found[1];
    }
  }
  return role;
}

export type CodexSession = {
  id: string; cwd: string; updated_at: number; name?: string; title?: string; first_user_message?: string;
  rollout_path?: string; model?: string; git_branch?: string;
};

export const codexHome = () => process.env.CODEX_HOME || join(homedir(), ".codex");

/** Returns the newest main sessions, excluding archived ones and subagents,
 * of the Codex in home: from the state database, which also covers
 * paginated history, or from rollouts in older installations. */
export function codexSessions(home = codexHome()): CodexSession[] {
  let names: string[] = [];
  try {
    names = readdirSync(home);
  } catch {
    return [];
  }
  const databases = names.filter((n) => /^state_\d+\.sqlite$/.test(n))
    .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  for (const name of databases) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(join(home, name), { readOnly: true });
      const rows = db.prepare("SELECT * FROM threads WHERE archived = 0 ORDER BY updated_at DESC").all() as (CodexSession & { source: string })[];
      return rows.filter((r) => !/^(\{|subagent)/.test(r.source));
    } catch {
      continue;
    } finally {
      db?.close();
    }
  }
  return rolloutSessions(home);
}

/** Returns the sessions in the rollouts of the Codex in home, newest first. */
function rolloutSessions(home: string): CodexSession[] {
  const titles = new Map<string, string>();
  try {
    for (const line of readFileSync(join(home, "session_index.jsonl"), "utf8").split("\n")) {
      try {
        const item = JSON.parse(line);
        titles.set(item.id, item.thread_name ?? "");
      } catch {}
    }
  } catch {}
  let files: string[] = [];
  try {
    files = (readdirSync(join(home, "sessions"), { recursive: true }) as string[]).filter((f) => f.endsWith(".jsonl"));
  } catch {}
  const sessions: CodexSession[] = [];
  for (const file of files) {
    const path = join(home, "sessions", file);
    try {
      const record = JSON.parse(readFileSync(path, "utf8").split("\n", 1)[0]);
      const meta = record.payload ?? {};
      const id = meta.id || meta.session_id;
      if (record.type !== "session_meta" || typeof meta.source !== "string" || !id || !meta.cwd) continue;
      sessions.push({ ...meta, id, title: titles.get(id) ?? "", rollout_path: path, updated_at: statSync(path).mtimeMs / 1000 });
    } catch {}
  }
  return sessions.sort((a, b) => b.updated_at - a.updated_at);
}

/** Returns the latest context usage in a legacy rollout, in percent, or
 * null when it isn't there. */
export function codexContext(path: string): number | null {
  let lines: string[];
  try {
    lines = tail(path, 262144)[0].split("\n");
  } catch {
    return null;
  }
  for (const line of lines.reverse()) {
    try {
      const { payload } = JSON.parse(line);
      if (payload?.type !== "token_count") continue;
      const window = payload.info?.model_context_window;
      const used = payload.info?.last_token_usage?.total_tokens;
      if (window && used !== undefined && used !== null) return Math.min(100, Math.floor((used * 100) / window));
    } catch {}
  }
  return null;
}

export type SessionDir = { cwd: string; branch: string; at: string; title: string };

/** Returns the last record with a cwd in the transcript at path, or null.
 * cwd never changes within a session, so its end is enough, unless it has
 * no such record. */
function lastCwd(path: string): { cwd: string; gitBranch?: string; timestamp?: string } | null {
  for (const bytes of [65536, Infinity]) {
    const [text, size] = tail(path, bytes);
    for (const line of text.split("\n").reverse()) {
      if (!line.includes('"cwd"')) continue;
      try {
        const record = JSON.parse(line);
        if (record.cwd) return record;
      } catch {}
    }
    if (size <= bytes) break;
  }
  return null;
}

/** Returns the directories past Claude Code sessions in home ran in, newest
 * first, each with the most recent session's branch and title. */
export function claudeSessionDirs(home = homedir()): SessionDir[] {
  const root = join(home, ".claude/projects");
  const seen = new Map<string, SessionDir & { path: string }>();
  let dirs: string[] = [];
  try {
    dirs = readdirSync(root);
  } catch {}
  for (const dir of dirs) {
    let names: string[] = [];
    try {
      names = readdirSync(join(root, dir)).filter((n) => n.endsWith(".jsonl"));
    } catch {}
    for (const name of names) {
      const path = join(root, dir, name);
      try {
        const record = lastCwd(path);
        if (!record?.timestamp) continue;
        const known = seen.get(record.cwd);
        if (!known || record.timestamp > known.at) {
          seen.set(record.cwd, { cwd: record.cwd, branch: record.gitBranch ?? "", at: record.timestamp, title: "", path });
        }
      } catch {}
    }
  }
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).map(({ path, ...dir }) => {
    try {
      return { ...dir, title: title(path) };
    } catch {
      return dir;
    }
  });
}

/** Returns the directories of sessions, Codex's, newest first. */
export function codexSessionDirs(sessions: CodexSession[]): SessionDir[] {
  const seen = new Set<string>();
  return sessions.flatMap((s) => {
    if (seen.has(s.cwd)) return [];
    seen.add(s.cwd);
    return [{
      cwd: s.cwd, branch: s.git_branch ?? "", at: new Date(s.updated_at * 1000).toISOString(),
      title: (s.name || s.title || "").split(/\s+/).filter(Boolean).join(" "),
    }];
  });
}

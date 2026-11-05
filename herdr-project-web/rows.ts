// What the project picker lists and how it opens what the user picks:
// projects under ~/project, their agents' sessions, and what waits on the
// user.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { frontMatter } from "./inbox.ts";
import { type Agent, AGENTS, newProject, quote } from "./launch.ts";
import { type CodexSession, codexContext, reportedRole, title, transcriptDir, transcripts } from "./sessions.ts";
import type { Herdr, State } from "./state.ts";

// Kind, directory, agent:session, and what the picker shows.
export type Row = [string, string, string, string];

export type PaneRecord = { agent: string | null; workspace: string; cwd: string; pane: string; session: string; role: string };

/** Returns the panes of herdr as the picker uses them. */
export function paneRecords(herdr: Herdr | null): PaneRecord[] {
  return (herdr?.panes ?? []).map((p) => ({
    agent: p.agent ?? null,
    workspace: p.workspace_id,
    cwd: p.cwd ?? "",
    pane: p.pane_id,
    session: p.agent_session?.value ?? "",
    role: p.tokens?.role ?? "",
  }));
}

const inDir = (cwd: string, dir: string) => cwd === dir || cwd.startsWith(`${dir}/`);

// Reading transcripts is slow and they rarely change, so what they say is
// kept by path and modification time.
const memo = new Map<string, [number, unknown]>();
function cached<T>(kind: string, path: string, read: (path: string) => T): T {
  const key = `${kind}:${path}`;
  const at = statSync(path).mtimeMs;
  const hit = memo.get(key);
  if (hit?.[0] === at) return hit[1] as T;
  const value = read(path);
  memo.set(key, [at, value]);
  return value;
}

type Session = { agent: string; id: string; updatedAt: number; transcript?: string; codex?: CodexSession };

/** Returns Claude and Codex sessions in directory together, newest first. */
function sessions(directory: string, codex: CodexSession[], home: string): Session[] {
  return [
    ...transcripts(directory, home).map((t) => ({ agent: "claude", id: t.id, updatedAt: t.updatedAt, transcript: t.path })),
    ...codex.filter((s) => s.cwd === directory).map((s) => ({ agent: "codex", id: s.id, updatedAt: s.updated_at, codex: s })),
  ].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Returns the title of a session. */
function sessionTitle(s: Session): string {
  if (s.codex) {
    const text = s.codex.name || s.codex.title || s.codex.first_user_message || "(untitled)";
    return text.split(/\s+/).filter(Boolean).join(" ").slice(0, 60);
  }
  return cached("title", s.transcript!, title) || "(untitled)";
}

/** Returns the context usage of a session, as the status line left it in
 * directory, or from its rollout, or "" if neither says. */
function context(directory: string, s: Session): string {
  try {
    const used = JSON.parse(readFileSync(join(directory, `${s.agent}-${s.id}.json`), "utf8"));
    if (typeof used.used_percentage === "number") return `${Math.trunc(used.used_percentage)}%`;
  } catch {}
  const pct = s.codex?.rollout_path ? codexContext(s.codex.rollout_path) : null;
  return pct === null ? "" : `${pct}%`;
}

const readme = (dir: string) => {
  try {
    return readFileSync(join(dir, "README.md"), "utf8");
  } catch {
    return null;
  }
};

/** Reports whether path is a directory, or a link to one. */
function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function when(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Returns the rows for the projects in the directory projects and their
 * sessions after a row for a new one. Projects with an agent running come
 * first, then open ones; directory names start with the date, so reverse
 * order within those puts the newest first. */
export function choices(panes: PaneRecord[], projects: string, codex: CodexSession[], home = homedir()): Row[] {
  const running = new Set(panes.filter((p) => p.session).map((p) => `${p.agent}:${p.session}`));
  const active = panes.filter((p) => AGENTS.includes(p.agent as Agent)).map((p) => p.cwd);
  const rows: Row[] = [["new", "", "", "+ new project"]];
  mkdirSync(projects, { recursive: true });
  const dirs = readdirSync(projects).filter((name) => !name.startsWith(".") && isDir(join(projects, name))).map((name) => {
    const dir = join(projects, name);
    const text = readme(dir);
    const closed = Boolean(text && frontMatter(text, "closed"));
    return { dir, name, text, closed, busy: active.some((c) => inDir(c, dir)) };
  }).sort((a, b) => Number(b.busy) - Number(a.busy) || Number(a.closed) - Number(b.closed) || b.name.localeCompare(a.name));
  for (const { dir, name, text, closed } of dirs) {
    let summary = text === null ? "(no notes)" : frontMatter(text, "title") || "(no title)";
    if (closed) summary += " (closed)";
    rows.push(["project", dir, "", `${name}  ${summary}`]);
    for (const s of sessions(dir, codex, home)) {
      const mark = running.has(`${s.agent}:${s.id}`) ? "●" : " ";
      rows.push(["session", dir, `${s.agent}:${s.id}`,
                 `  ${mark} ${s.agent.padEnd(8)} ${when(s.updatedAt)} ${context(dir, s).padStart(4)}  ${sessionTitle(s)}`]);
    }
  }
  return rows;
}

// How inbox rows show where an item comes from.
const SOURCES: Record<string, string> = {
  you: "you", "?": "you?", maybe: "maybe", close: "close?", pr: "pr", slack: "slack", linear: "linear", ctx: "ctx", idle: "idle",
};
const source = (mark: string) => (SOURCES[mark] ?? mark).padEnd(6);

/** Returns agent:session for role's running or saved session in directory,
 * else the newest, or "" if there is none. */
function sessionFor(directory: string, role: string | null, panes: PaneRecord[], codex: CodexSession[], home: string): string {
  const pane = panes.find((p) => AGENTS.includes(p.agent as Agent) && p.session && role && p.role === role && inDir(p.cwd, directory));
  if (pane) return `${pane.agent}:${pane.session}`;
  const found = sessions(directory, codex, home);
  const owner = role ? found.find((s) => s.transcript && cached("role", s.transcript, reportedRole) === role) : undefined;
  const best = owner ?? found[0];
  return best ? `${best.agent}:${best.id}` : "";
}

/** Returns the rows for what waits on the user in state: the items of its
 * projects, newest first, then those without a project. */
export function inboxChoices(panes: PaneRecord[], codex: CodexSession[], state: State, home = homedir()): Row[] {
  const running = new Set(panes.filter((p) => p.session).map((p) => `${p.agent}:${p.session}`));
  const rows: Row[] = [];
  for (const project of [...state.projects].sort((a, b) => b.dir.localeCompare(a.dir))) {
    if (!project.items.length) continue;
    rows.push(["project", project.dir, "", `${project.dir.split("/").pop()}  ${project.title}`]);
    const sids = new Map<string | null, string>();
    for (const item of project.items) {
      if (!sids.has(item.role)) sids.set(item.role, sessionFor(project.dir, item.role, panes, codex, home));
      const sid = sids.get(item.role)!;
      const mark = running.has(sid) ? "●" : " ";
      rows.push(["session", project.dir, sid, `  ${mark} ${sid.split(":")[0].padEnd(8)} ${source(item.mark)} ${item.text}`]);
    }
  }
  for (const item of state.unowned) rows.push(["new", "", "", `+ ${source(item.mark)} ${item.text}`]);
  return rows;
}

/** Returns the notes in directory: AGENT-<role>.md if role is given and
 * the file exists, else README.md, then every AGENT-*.md. */
export function notes(directory: string, role: string | null = null): string {
  if (!directory) return "";
  const read = (name: string) => {
    try {
      return readFileSync(join(directory, name), "utf8");
    } catch {
      return null;
    }
  };
  if (role) {
    const own = read(`AGENT-${role}.md`);
    if (own !== null) return own;
  }
  let names: string[] = [];
  try {
    names = readdirSync(directory).filter((n) => /^AGENT-.*\.md$/.test(n)).sort();
  } catch {}
  return ["README.md", ...names].map((n) => read(n) ?? "").join("");
}

/** Returns the notes of a row: its session's role's, or all the project's. */
export function rowNotes(kind: string, directory: string, session: string, home = homedir()): string {
  const [agent, id] = session.split(":");
  if (kind === "session" && agent === "claude" && id) {
    const path = join(transcriptDir(directory, home), `${id}.jsonl`);
    return notes(directory, existsSync(path) ? cached("role", path, reportedRole) : null);
  }
  return notes(directory);
}

/** Returns the ID and status of Claude session sid if it runs in the
 * background, from claude agents --json, else null. */
export async function background(sid: string): Promise<[string, string] | null> {
  try {
    const { stdout } = await promisify(execFile)("claude", ["agents", "--json"], { timeout: 20_000 });
    const found = JSON.parse(stdout).find((a: any) => a.kind === "background" && a.sessionId === sid);
    return found ? [found.id, found.status] : null;
  } catch {
    return null;
  }
}

export type Plan = { focus: string } | { workspace: string | null; directory: string; command: string };

export type PlanDeps = {
  background: (sid: string) => Promise<[string, string] | null>;
  // Stops a background session, returning whether it did.
  stop: (id: string) => Promise<boolean>;
  now: () => Date;
};

/** Returns how to open row with agent for one without a session: focus
 * the pane running its session, or run command in a new tab of the
 * project's workspace, or in a new workspace if that is null. launcher is
 * the command that starts an agent. Creates a project under projects for a new one, and stops a background
 * Claude session it resumes if the session is idle. */
export async function plan(
  [kind, dir, session]: Row, agent: string, panes: PaneRecord[], projects: string, launcher: string, deps: PlanDeps,
): Promise<Plan> {
  const [selected, sid] = session ? [session.slice(0, session.indexOf(":")), session.slice(session.indexOf(":") + 1)] : [agent, ""];
  const directory = kind === "new" ? newProject(projects, deps.now()) : dir;
  let command = `${quote(launcher)} --agent ${quote(selected)}`;
  if (sid) {
    const pane = panes.find((p) => p.agent === selected && p.session === sid);
    if (pane) return { focus: pane.pane };
    const bg = selected === "claude" ? await deps.background(sid) : null;
    if (bg && !(bg[1] === "idle" && (await deps.stop(bg[0])))) command = `claude attach ${quote(bg[0])}`;
    else command += ` --resume ${quote(sid)}`;
  }
  const workspace = panes.find((p) => inDir(p.cwd, directory))?.workspace ?? null;
  return { workspace, directory, command };
}

export type OpenHerdr = {
  focus: (pane: string) => Promise<unknown>;
  // Each returns the pane created.
  tab: (workspace: string, directory: string) => Promise<string>;
  workspace: (directory: string, label: string | null) => Promise<{ workspace: string; pane: string }>;
  title: (workspace: string, directory: string) => Promise<unknown>;
  run: (pane: string, command: string) => Promise<unknown>;
};

/** Returns the agents' workspaces to name after the projects they work in,
 * by project directory, from herdr, skipping projects in done. projectOf
 * returns the project holding a directory, and nameOf its name, or "". */
export function workspacesToName(
  herdr: Herdr | null, done: Set<string>, projectOf: (cwd: string) => string | null, nameOf: (dir: string) => string,
): { dir: string; workspace: string; name: string }[] {
  const found = new Map<string, { dir: string; workspace: string; name: string }>();
  for (const p of herdr?.panes ?? []) {
    const dir = p.agent ? projectOf(p.tokens?.cwd || p.cwd || "") : null;
    if (!dir || done.has(dir) || found.has(dir)) continue;
    const name = nameOf(dir);
    if (name) found.set(dir, { dir, workspace: p.workspace_id, name });
  }
  return [...found.values()];
}

/** Opens in Herdr what plan returned. */
export async function open(planned: Plan, herdr: OpenHerdr) {
  if ("focus" in planned) return void (await herdr.focus(planned.focus));
  const { directory, command } = planned;
  let { workspace } = planned;
  let pane: string;
  if (workspace) pane = await herdr.tab(workspace, directory);
  else {
    const text = readme(directory);
    ({ workspace, pane } = await herdr.workspace(directory, (text && frontMatter(text, "name")) || null));
  }
  // Without herdr-project, nothing else reports the title.
  if (command.startsWith("claude attach ")) await herdr.title(workspace, directory);
  await herdr.run(pane, command);
}

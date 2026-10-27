// Watching Herdr panes for agents whose context is nearly full and shell
// panes that have long been idle.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { FULL_AT, type Item } from "./inbox.ts";
import { projectName } from "./owners.ts";
import type { Herdr } from "./state.ts";
import { loadState, saveState } from "./statefile.ts";

type HerdrPane = Herdr["panes"][number];

// How long a shell pane's text may stay the same before it counts as
// idle, in milliseconds.
const IDLE_AFTER = 24 * 3600_000;

// What is kept between checks: a digest of each shell pane's text and
// since when, in ISO 8601, it has had it, and the agents already told
// their context is full.
export type PaneState = { panes: Record<string, { digest: string; since: string }>; told: string[] };

/** Returns how full the context of the agent in pane is, in percent,
 * from the ctx token its status line reports, or null. A background
 * session reports to the pane that started it, flagging that with the bg
 * token, so then the ctx isn't the pane's own. */
export function ctx(pane: HerdrPane): number | null {
  const text = pane.tokens?.ctx;
  if (pane.tokens?.bg || typeof text !== "string") return null;
  return /^\d+%*$/.test(text) ? parseInt(text, 10) : null;
}

/** Returns the directory pane works in: the cwd its agent reports, else
 * Herdr's, else "". */
export function paneCwd(pane: HerdrPane): string {
  return pane.tokens?.cwd || pane.cwd || "";
}

/** Returns the panes among panes that run no agent and share no tab with
 * one, such as a pane following an agent's notes. */
export function shells(panes: HerdrPane[]): HerdrPane[] {
  const agentTabs = new Set(panes.filter((p) => p.agent).map((p) => p.tab_id));
  return panes.filter((p) => !p.agent && !agentTabs.has(p.tab_id));
}

/** Returns the state to keep for panes, from old, the state it returned
 * last time, if any, and texts, the text of each shell pane by id, at
 * now: a digest of each shell pane's text and since when it has had it,
 * and the agents already told their context is full, as long as it
 * stays full or unknown. */
export function remember(old: unknown, panes: HerdrPane[], texts: Record<string, string>, now: Date): PaneState {
  const o = old && typeof old === "object" ? (old as Record<string, unknown>) : {};
  const seen = o.panes && typeof o.panes === "object" ? (o.panes as Record<string, unknown>) : {};
  const kept: PaneState["panes"] = {};
  for (const [id, text] of Object.entries(texts)) {
    const digest = createHash("sha256").update(text).digest("hex");
    const before = seen[id] as { digest?: unknown; since?: unknown } | undefined;
    kept[id] =
      before?.digest === digest && typeof before.since === "string"
        ? { digest, since: before.since }
        : { digest, since: now.toISOString() };
  }
  const told = new Set(Array.isArray(o.told) ? o.told : []);
  return {
    panes: kept,
    told: panes
      .filter((p) => told.has(p.pane_id) && (ctx(p) === null || ctx(p)! >= FULL_AT))
      .map((p) => p.pane_id),
  };
}

/** Returns the shell panes among panes whose text hasn't changed for a
 * day, by state, with for how many milliseconds, the longest idle
 * first. */
export function idle(state: PaneState, panes: HerdrPane[], now: Date): [HerdrPane, number][] {
  const out: [HerdrPane, number][] = [];
  for (const p of shells(panes)) {
    const since = Date.parse(state.panes[p.pane_id]?.since ?? "");
    if (!Number.isNaN(since) && now.getTime() - since >= IDLE_AFTER) out.push([p, now.getTime() - since]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

/** Returns the agent panes among panes whose context is at least FULL_AT
 * percent full, the fullest first. */
export function full(panes: HerdrPane[]): HerdrPane[] {
  return panes.filter((p) => p.agent && (ctx(p) ?? 0) >= FULL_AT).sort((a, b) => ctx(b)! - ctx(a)!);
}

/** Returns the project directory directly under root that holds cwd, or
 * null if cwd isn't in one. Symlinks in either path don't matter. */
export function projectDir(cwd: string, root: string): string | null {
  if (!cwd) return null;
  const rel = relative(real(root), real(cwd));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return join(root, rel.split(sep)[0]);
}

/** Returns path with the symlinks in the part of it that exists
 * resolved. */
function real(path: string): string {
  const parent = dirname(path);
  try {
    return realpathSync(path);
  } catch {
    return parent === path ? path : join(real(parent), basename(path));
  }
}

/** Returns what to tell the agent in pane about its full context. */
export function wakeMessage(pane: HerdrPane): string {
  return `Your context is ${ctx(pane)}% full. Update your notes so that a new session can pick up from them, then tell the user.`;
}

/** Returns span, in milliseconds, in whole days or hours, like 3d or 20h. */
export function days(span: number): string {
  const hours = Math.floor(span / 3600_000);
  return hours >= 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
}

// What checkPanes needs from Herdr: the panes it lists, the recent text
// of a pane by id, and running text as a command in a pane. Each throws
// if Herdr fails.
export type PaneHerdr = {
  list(): Promise<HerdrPane[]>;
  read(id: string): Promise<string>;
  run(id: string, text: string): Promise<void>;
};

/** Checks the panes once at now: tells each agent whose context became
 * full since the state kept in path to update its notes, if it is idle
 * or done, keeps the new state there, and returns lines listing full
 * agents and idle shell panes, and inbox items for those in projects
 * under root. Only agents in projects are told. */
export async function checkPanes(herdr: PaneHerdr, root: string, path: string, now: Date) {
  const panes = await herdr.list();
  const texts: Record<string, string> = {};
  for (const p of shells(panes)) {
    try {
      texts[p.pane_id] = await herdr.read(p.pane_id);
    } catch {} // Unknown, so it starts over as not idle.
  }
  const state = remember(loadState(path), panes, texts, now);
  saveState(path, state);
  const lines: string[] = [];
  const items: Item[] = [];
  const owner = (p: HerdrPane) => projectDir(paneCwd(p), root);
  for (const p of full(panes)) {
    const project = owner(p);
    const where = project ? projectName(project) : paneCwd(p);
    lines.push(`${String(ctx(p)).padStart(3)}% ${p.pane_id.padEnd(8)} ${where}`);
    // Only agents in projects keep notes to restart from.
    if (!project) continue;
    items.push({ project, role: p.tokens?.role || null, mark: "ctx",
                 text: `${where}: context ${ctx(p)}% full, restart it from its notes` });
    if (state.told.includes(p.pane_id) || !["idle", "done"].includes(p.agent_status ?? "")) continue;
    // Keep it told before telling, so a failed save can't tell it again.
    state.told.push(p.pane_id);
    saveState(path, state);
    try {
      await herdr.run(p.pane_id, wakeMessage(p));
    } catch {
      state.told.splice(state.told.indexOf(p.pane_id), 1);
      saveState(path, state);
    }
  }
  for (const [p, span] of idle(state, panes, now)) {
    const project = owner(p);
    const where = project ? projectName(project) : paneCwd(p);
    lines.push(`${days(span).padStart(4)} ${p.pane_id.padEnd(8)} ${where}`);
    if (project)
      items.push({ project, role: p.tokens?.role || null, mark: "idle",
                   text: `shell pane ${p.pane_id} idle for ${days(span)}` });
  }
  return { lines: lines.length ? lines : ["Nothing to clean up."], items };
}

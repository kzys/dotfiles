// Comments on the lines of a diff or a Markdown file, kept in the browser
// until they go to an agent as one message.

import { type FileDiff, filePath } from "./diff.ts";
import { type AgentState, statusState } from "./pulls.ts";
import type { State } from "./state.ts";

// code is what it is on: one line of a diff, or the lines of a Markdown
// block, which start at line.
export type Comment = { path: string; side: "old" | "new"; line: number; code: string; body: string };

/** Returns what identifies the line a comment is on, its code included:
 * after an edit above it, its number holds another line. */
export const commentKey = (c: Pick<Comment, "path" | "side" | "line" | "code">) => `${c.path}:${c.side}:${c.line}:${c.code}`;

/** Returns comments with the one on c's line replaced by c, or removed if
 * c says nothing, in the order of the diff's files and lines. */
export function withComment(comments: Comment[], c: Comment): Comment[] {
  const others = comments.filter((o) => commentKey(o) !== commentKey(c));
  const all = c.body.trim() ? [...others, c] : others;
  return all.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.side.localeCompare(b.side));
}

/** Returns the message that gives an agent comments on what is in dir,
 * on branch if it has one. */
export function reviewMessage(dir: string, branch: string | null, comments: Comment[]): string {
  const parts = comments.map((c) => {
    const removed = c.side === "old" ? " (removed line)" : "";
    const lines = c.code.split("\n");
    const to = lines.length > 1 ? `-${c.line + lines.length - 1}` : "";
    return `${c.path}:${c.line}${to}${removed}\n${lines.map((l) => `> ${l}`).join("\n")}\n${c.body.trim()}`;
  });
  return `Review comments on ${dir}${branch ? ` (${branch})` : ""}. Address each, then say what you did.\n\n${parts.join("\n\n")}`;
}

export type Reviewer = { id: string; label: string; inside: boolean };

/** Returns the agents that can take comments on what is in dir, a project
 * or a worktree: those of the projects that work in it, the ones inside it
 * first, in an order that stays put as projects change rank. */
export function reviewers(
  projects: { name: string; dir: string; worktrees: { dir: string }[]; panes: { id: string; role: string | null; cwd: string | null }[] }[],
  dir: string,
): Reviewer[] {
  const within = (cwd: string | null) => cwd === dir || !!cwd?.startsWith(`${dir}/`);
  return projects.filter((p) => p.dir === dir || p.worktrees.some((w) => w.dir === dir))
    .flatMap((p) => p.panes.map((a) => ({
      id: a.id, label: a.role ? `${p.name} · ${a.role} (${a.id})` : `${p.name} · ${a.id}`, inside: within(a.cwd),
    })))
    .sort((x, y) => Number(y.inside) - Number(x.inside) || x.id.localeCompare(y.id));
}

/** Returns the agent to send comments to without asking, or null: the only
 * one offered, or the only one inside the diff. Any other choice would be
 * a guess, and the comments would go to an agent that knows nothing of them. */
export function clearReviewer(agents: Reviewer[]): Reviewer | null {
  const inside = agents.filter((a) => a.inside);
  if (inside.length === 1) return inside[0];
  return agents.length === 1 ? agents[0] : null;
}

type Receiving = Pick<State, "agents" | "controls" | "undelivered">;

/** Returns how many messages for the agent in pane wait to reach it and
 * how many never will, as when it restarted as another session. */
function waitingFor(state: Receiving, pane: string): [number, number] {
  const lost = state.undelivered?.find((u) => u.pane === pane)?.messages.length ?? 0;
  return [(state.controls?.[pane]?.queued.length ?? 0) - lost, lost];
}

/** Reports whether state shows the agent in pane busy with nothing left
 * to reach it, so with what it was sent. */
export function receiverStarted(state: Receiving | null, pane: string): boolean {
  const agent = statusState(state?.agents?.[pane]);
  return !!state && (agent === "working" || agent === "blocked") && waitingFor(state, pane)[0] <= 0;
}

/** Returns what the agent in pane is doing according to state, as its
 * state and in words, with what hasn't reached it. An agent is idle both
 * before and after working, so unless started, when it was seen working,
 * its being idle says nothing of what it was sent. */
export function receiverStatus(state: Receiving | null, pane: string, started: boolean): [AgentState, string] {
  const status = state?.agents?.[pane];
  if (!state?.agents) return ["unknown", "unknown"];
  if (status === undefined) return ["unknown", "gone"];
  const agent = statusState(status);
  const [queued, lost] = waitingFor(state, pane);
  if (lost) return [agent, `${agent}, ${lost} undelivered`];
  if (queued > 0) return [agent, `${agent}, ${queued} waiting to reach it`];
  return [agent, agent === "idle" && !started ? "idle, not seen working yet" : agent];
}

/** Returns the comments no block of a Markdown file at path holds any
 * more, as blocks lists them. */
export function displacedFromBlocks(comments: Comment[], path: string, blocks: { line: number; code: string }[]): Comment[] {
  const held = new Set(blocks.map((b) => commentKey({ path, side: "new", ...b })));
  return comments.filter((c) => !held.has(commentKey(c)));
}

/** Returns the comments no line of files holds any more: their line left
 * the diff, or now reads differently, as when an agent edited above it. */
export function displaced(comments: Comment[], files: FileDiff[]): Comment[] {
  const lines = new Set<string>();
  for (const file of files) {
    const path = filePath(file);
    for (const hunk of file.hunks) {
      for (const l of hunk.lines) {
        const side = l.kind === "del" ? "old" : "new";
        if (l[side] !== null) lines.add(commentKey({ path, side, line: l[side]!, code: l.text }));
      }
    }
  }
  return comments.filter((c) => !lines.has(commentKey(c)));
}

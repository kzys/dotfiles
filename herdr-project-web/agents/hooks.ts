// Agents' hook events, which they post to a Unix socket so that the
// server knows what each agent in a Herdr pane last did. File permissions
// guard the socket, and browsers can't reach it.

import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { getRequestListener } from "@hono/node-server";
import { type Context, Hono } from "hono";
import { limit } from "../http.ts";

const AGENTS = new Set(["claude", "codex", "opencode"]);

// What a permission request asks for is kept to show the user, this long
// at most.
const MAX_DETAIL = 500;

export type HookEvent = { agent: string; event: string; session: string | null; detail: string | null; at: number };

// Tools whose prompts ask something other than whether to allow them.
const QUESTIONS = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** Returns what a hook's event data asks permission for, or null. */
export function hookDetail(data: { tool_name?: unknown; tool_input?: unknown }): string | null {
  if (typeof data?.tool_name !== "string" || QUESTIONS.has(data.tool_name)) return null;
  const detail = `${data.tool_name}: ${JSON.stringify(data.tool_input ?? {})}`;
  return detail.length > MAX_DETAIL ? `${detail.slice(0, MAX_DETAIL)}…` : detail;
}

/** Reports whether a process with these ancestors' command lines, or
 * null if they aren't all known, speaks for its Herdr pane. Background
 * sessions run under the Claude Code daemon's --bg-pty-host, and inherit
 * the HERDR_* variables of the pane that started the daemon without
 * running in it. A Claude started by another one inherits them too, and
 * the pane belongs to the outer one. */
export function ownsPane(commands: string[] | null): boolean {
  if (!commands || commands.some((c) => c.includes("--bg-pty-host"))) return false;
  return commands.filter((c) => /^(\S*\/)?claude(\s|$)/.test(c)).length <= 1;
}

/** Returns the command lines of process pid and its ancestors, up to but
 * not including init, or null if one is gone. */
export async function ancestors(pid: number): Promise<string[] | null> {
  const commands: string[] = [];
  while (pid > 1) {
    const { stdout } = await promisify(execFile)("ps", ["-o", "ppid=,args=", "-p", String(pid)]).catch(() => ({ stdout: "" }));
    const m = /^\s*(\d+)\s+(.*)/.exec(stdout);
    if (!m) return null;
    commands.push(m[2]);
    pid = Number(m[1]);
  }
  return commands;
}

/** Returns the Herdr pane a request speaks for, from X-Herdr-Pane, with
 * the posting process in X-Agent-Pid, and whether the process really runs
 * in it, or null if it names no pane. */
export async function speaker(headers: Headers, lineage = ancestors): Promise<{ pane: string; own: boolean } | null> {
  const pane = headers.get("x-herdr-pane");
  const pid = Number(headers.get("x-agent-pid"));
  if (!pane) return null;
  return { pane, own: pid > 1 && ownsPane(await lineage(pid)) };
}

// What happened, with the pane the agent owns, if any.
export type HookHandler = (pane: string | null, hook: { agent: string; event: string }, data: any) => Promise<string>;

// Where the last hook event of each pane is kept, by pane: a Map, or what
// keeps them elsewhere.
export type HookLog = {
  get(pane: string): HookEvent | undefined;
  set(pane: string, event: HookEvent): unknown;
  entries(): Iterable<[string, HookEvent]>;
};

/** Returns a server that keeps the last hook event of each pane in
 * latest, by pane. POST /hooks/:agent/:event takes the event's JSON, with
 * the pane as speaker reads it, ignores subagents, and replies with what
 * handle returns, for the agent's context; GET /hooks lists latest.
 * lineage returns a process's ancestors' command lines. Other requests go
 * to app's own routes. */
export function hookServer(
  latest: HookLog,
  lineage = ancestors,
  handle: HookHandler = async () => "",
  app = new Hono(),
): Server {
  async function post(c: Context, hook: { agent: string; event: string }) {
    const at = Date.now();
    let data: { agent_id?: unknown; session_id?: unknown; tool_name?: unknown; tool_input?: unknown };
    try {
      const body = await c.req.text();
      data = body ? JSON.parse(body) : {};
    } catch {
      return c.body(null, 400);
    }
    // Nor does a Codex started by another's thread own the pane.
    const thread = c.req.header("x-codex-thread");
    if (data?.agent_id || (hook.agent === "codex" && thread && thread !== data?.session_id)) return c.body(null, 204);
    const who = await speaker(c.req.raw.headers, lineage);
    const pane = who?.own ? who.pane : null;
    if (pane) {
      const session = typeof data?.session_id === "string" ? data.session_id : null;
      const last = latest.get(pane);
      // Checking the ancestors can reorder events close together, and
      // Claude Code follows a permission request with a notification of it.
      const repeats = hook.event === "Notification" && last?.event === "PermissionRequest";
      if (at >= (last?.at ?? 0) && !repeats) latest.set(pane, { ...hook, session, detail: hookDetail(data), at });
    }
    const reply = await handle(pane, hook, data);
    return reply ? c.text(reply) : c.body(null, 204);
  }
  for (const agent of AGENTS) {
    // An error's text would reach the agent's context.
    app.post(`/hooks/${agent}/:event{[A-Za-z]+}`, limit(), (c) =>
      post(c, { agent, event: c.req.param("event") }).catch(() => c.body(null, 500))
    );
  }
  app.get("/hooks", (c) => c.json(Object.fromEntries(latest.entries())));
  return createServer(getRequestListener(app.fetch));
}

/** Listens on the socket at path, replacing one left by an earlier run,
 * in a directory only this user can enter. */
export function listenOn(server: Server, path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  chmodSync(dirname(path), 0o700);
  rmSync(path, { force: true });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
}

// Agents' hook events, which they post to a Unix socket so that the
// server knows what each agent in a Herdr pane last did. File permissions
// guard the socket, and browsers can't reach it.

import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { dirname } from "node:path";
import { promisify } from "node:util";

const AGENTS = new Set(["claude", "codex", "opencode"]);
// Far more than a hook's event needs, to bound what's kept in memory.
const MAX_BODY = 1 << 20;

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

/** Returns the agent and event of a hook's request path, or null if it
 * isn't one. */
export function hookPath(path: string): { agent: string; event: string } | null {
  const m = /^\/hooks\/([a-z]+)\/([A-Za-z]+)$/.exec(path);
  return m && AGENTS.has(m[1]) ? { agent: m[1], event: m[2] } : null;
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

/** Reads the body of req, or returns null if it's too large. */
export async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

/** Returns the Herdr pane a request speaks for, from X-Herdr-Pane, with
 * the posting process in X-Agent-Pid, and whether the process really runs
 * in it, or null if it names no pane. */
export async function speaker(req: IncomingMessage, lineage = ancestors): Promise<{ pane: string; own: boolean } | null> {
  const pane = req.headers["x-herdr-pane"];
  const pid = Number(req.headers["x-agent-pid"]);
  if (typeof pane !== "string" || !pane) return null;
  return { pane, own: pid > 1 && ownsPane(await lineage(pid)) };
}

// What happened, with the pane the agent owns, if any.
export type HookHandler = (pane: string | null, hook: { agent: string; event: string }, data: any) => Promise<string>;

/** Returns a server that keeps the last hook event of each pane in
 * latest, by pane. POST /hooks/:agent/:event takes the event's JSON, with
 * the pane as speaker reads it, ignores subagents, and replies with what
 * handle returns, for the agent's context; GET /hooks lists latest.
 * lineage returns a process's ancestors' command lines. Other requests go
 * to other, given the request's URL. */
export function hookServer(
  latest: Map<string, HookEvent>,
  lineage = ancestors,
  handle: HookHandler = async () => "",
  other = (_req: IncomingMessage, res: ServerResponse, _url: URL) => void res.writeHead(404).end(),
): Server {
  async function post(req: IncomingMessage, res: ServerResponse, hook: { agent: string; event: string }) {
    const at = Date.now();
    const body = await readBody(req);
    if (body === null) return res.writeHead(413).end();
    let data: { agent_id?: unknown; session_id?: unknown; tool_name?: unknown; tool_input?: unknown };
    try {
      data = body ? JSON.parse(body) : {};
    } catch {
      return res.writeHead(400).end();
    }
    // Nor does a Codex started by another's thread own the pane.
    const thread = req.headers["x-codex-thread"];
    if (data?.agent_id || (hook.agent === "codex" && thread && thread !== data?.session_id)) return res.writeHead(204).end();
    const who = await speaker(req, lineage);
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
    if (reply) return res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(reply);
    res.writeHead(204).end();
  }
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const hook = hookPath(path);
    if (req.method === "POST" && hook) {
      post(req, res, hook).catch(() => res.writeHead(500).end());
    } else if (req.method === "GET" && path === "/hooks") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(Object.fromEntries(latest)));
    } else {
      other(req, res, url);
    }
  });
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

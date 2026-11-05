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

export type HookEvent = { agent: string; event: string; session: string | null; at: number };

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
async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

/** Returns a server that keeps the last hook event of each pane in
 * latest, by pane. POST /hooks/:agent/:event takes the event's JSON, with
 * the pane in X-Herdr-Pane and the posting process in X-Agent-Pid, and
 * ignores subagents and processes outside the pane; GET /hooks lists
 * latest. lineage returns a process's ancestors' command lines. */
export function hookServer(latest: Map<string, HookEvent>, lineage = ancestors): Server {
  async function post(req: IncomingMessage, res: ServerResponse, hook: { agent: string; event: string }) {
    const at = Date.now();
    const body = await readBody(req);
    if (body === null) return res.writeHead(413).end();
    let data: { agent_id?: unknown; session_id?: unknown };
    try {
      data = body ? JSON.parse(body) : {};
    } catch {
      return res.writeHead(400).end();
    }
    const pane = req.headers["x-herdr-pane"];
    const pid = Number(req.headers["x-agent-pid"]);
    if (typeof pane === "string" && pane && pid > 1 && !data?.agent_id && ownsPane(await lineage(pid))) {
      const session = typeof data?.session_id === "string" ? data.session_id : null;
      // Checking the ancestors can reorder events close together.
      if (at >= (latest.get(pane)?.at ?? 0)) latest.set(pane, { ...hook, session, at });
    }
    res.writeHead(204).end();
  }
  return createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const hook = hookPath(path);
    if (req.method === "POST" && hook) {
      post(req, res, hook).catch(() => res.writeHead(500).end());
    } else if (req.method === "GET" && path === "/hooks") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(Object.fromEntries(latest)));
    } else {
      res.writeHead(404).end();
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

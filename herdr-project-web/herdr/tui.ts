// Talking to the Herdr TUI: asking it through its socket, one request per
// connection, as its CLI does, rather than running the CLI each time, and
// keeping what it shows current.

import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import { HerdrEvents } from "../events.ts";
import { paneRecords } from "../rows.ts";
import { Schedule } from "../schedule.ts";
import type { Herdr } from "../state.ts";
import type { Backend, OpenHerdr } from "./backend.ts";

// An error Herdr replied with, as opposed to failing to reach it.
export class HerdrError extends Error {}

/** Sends method with params to the Herdr socket at path and returns the
 * result of its reply. Raises if Herdr replies with an error, or hasn't
 * replied in full within timeoutMs. */
export function request(path: string, method: string, params: object = {}, timeoutMs = 10_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = "";
    const fail = (e: Error) => {
      socket.destroy();
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error(`herdr ${method}: no reply in ${timeoutMs}ms`)), timeoutMs);
    socket.on("close", () => clearTimeout(timer));
    socket.on("error", fail);
    // Whole characters, even where one spans two reads.
    socket.setEncoding("utf8");
    socket.on("data", (data) => {
      buffer += data;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      socket.end();
      let reply: { result?: unknown; error?: { code?: string; message?: string } };
      try {
        reply = JSON.parse(buffer.slice(0, end));
      } catch {
        return reject(new Error(`herdr ${method}: bad reply`));
      }
      if (reply.error)
        reject(new HerdrError(`herdr ${method}: ${reply.error.code ?? "error"}: ${reply.error.message ?? ""}`));
      else resolve(reply.result);
    });
    socket.on("end", () => reject(new Error(`herdr ${method}: no reply`)));
    socket.write(`${JSON.stringify({ id: method, method, params })}\n`);
  });
}

/** Returns where Herdr's socket is, as its CLI, $HERDR_BIN_PATH if set,
 * finds it, for the session it reads. */
export async function herdrSocket(): Promise<string> {
  const { stdout } = await promisify(execFile)(process.env.HERDR_BIN_PATH || "herdr", ["status", "server"], {
    timeout: 5000,
  });
  const path = stdout.match(/^socket: (.+)$/m)?.[1];
  if (!path) throw new Error("herdr status server names no socket");
  return path;
}

export type Ask = (method: string, params?: object) => Promise<any>;

/** Returns ask, which returns the result of method with params from
 * Herdr, raising if it fails, and tryAsk, which returns null instead,
 * both through the socket that locate finds. Where the socket is gone,
 * as when Herdr came back elsewhere, ask finds it again and tries once
 * more; the request never reached Herdr, so it isn't sent twice. */
export function herdrClient(locate: () => Promise<string> = herdrSocket): { ask: Ask; tryAsk: Ask } {
  // Found again after a request can't reach it.
  let socketPath: Promise<string> | null = null;
  const ask = async (method: string, params: object = {}, again = true): Promise<any> => {
    const path = (socketPath ??= locate());
    try {
      return await request(await path, method, params);
    } catch (e) {
      if (e instanceof HerdrError) throw e;
      // Unless another request found it again already.
      if (socketPath === path) socketPath = null;
      const code = (e as NodeJS.ErrnoException).code;
      if (again && (code === "ENOENT" || code === "ECONNREFUSED")) return ask(method, params, false);
      throw e;
    }
  };
  return { ask: (method, params) => ask(method, params), tryAsk: (method, params) => ask(method, params).catch(() => null) };
}

/** Keeps what Herdr shows current, reading its workspaces and panes
 * through tryAsk when its events, through the socket that locate finds,
 * say something changed, and every minute, since panes' directories
 * change without events. Calls onRead with each read and the one before,
 * each null while Herdr can't be asked, and onError with what onRead
 * raises. Returns a function returning the last read. */
export function watchHerdr(
  tryAsk: Ask,
  onRead: (next: Herdr | null, before: Herdr | null) => void,
  options: { locate?: () => Promise<string>; onError?: (error: unknown) => void } = {},
): () => Herdr | null {
  let herdr: Herdr | null = null;
  const reads = new Schedule(async () => {
    const [w, p] = await Promise.all([tryAsk("workspace.list"), tryAsk("pane.list")]);
    const before = herdr;
    herdr = w && p ? { workspaces: w.workspaces, panes: p.panes } : null;
    // Each agent's state is its own subscription, and a failed one
    // subscribes again.
    events.update(herdr);
    onRead(herdr, before);
  }, { every: 60_000, onError: options.onError });
  const events = new HerdrEvents(options.locate ?? herdrSocket, () => reads.refresh());
  return () => herdr;
}

/** Returns the Herdr TUI as a Backend, asking it through ask. asking
 * reports whether an agent's pane has a permission request open, which
 * Herdr doesn't tell, and title gives a workspace made for a directory
 * its title. */
export function tuiBackend(
  ask: Ask,
  options: { asking: (pane: string) => boolean; title: (workspace: string, directory: string) => Promise<unknown> },
): Backend {
  // Typing the text and Enter, as herdr pane run does.
  const send = async (pane: string, text: string) => void (await ask("pane.send_input", { pane_id: pane, text, keys: ["Enter"] }));
  const opener: OpenHerdr = {
    focus: (pane) => ask("agent.focus", { target: pane }),
    tab: async (workspace, cwd) => (await ask("tab.create", { workspace_id: workspace, cwd, focus: true })).root_pane.pane_id,
    workspace: async (cwd, label) => {
      const { workspace, root_pane } = await ask("workspace.create", { cwd, focus: true, ...(label ? { label } : {}) });
      return { workspace: workspace.workspace_id, pane: root_pane.pane_id };
    },
    title: options.title,
    run: send,
  };
  return {
    async ready(pane) {
      const { pane: now } = await ask("pane.get", { pane_id: pane });
      const free = Boolean(now.agent) && ["idle", "done"].includes(now.agent_status) && !options.asking(pane);
      return free ? (now.agent_session?.value ?? "") : null;
    },
    send,
    focus: (pane) => ask("pane.focus", { pane_id: pane }),
    panes: async () => paneRecords({ workspaces: [], panes: (await ask("pane.list")).panes }),
    opener: () => opener,
  };
}

// The Herdr app, whose terminals herdr-core runs, beside Herdr: reading
// its panes and agents with hc, and opening the picker's rows with
// herdr-app commands.

import { execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { OpenHerdr, PaneRecord } from "./rows.ts";
import type { Herdr } from "./state.ts";

// herdr-core names some agents by their app, not their command.
const AGENTS: Record<string, string> = { "claude-code": "claude" };

/** Runs a command and returns its parsed JSON output. Raises if it fails. */
export type Json = (command: string, args: string[]) => Promise<any>;

// A busy or closed app shouldn't hang the picker.
const json: Json = async (command, args) => JSON.parse((await promisify(execFile)(command, args, { timeout: 10_000 })).stdout);

/** Returns the IDs of running Claude Code sessions by process ID, from the
 * files Claude Code keeps for them in directory. */
export function claudeSessions(directory = join(homedir(), ".claude/sessions")): Map<number, string> {
  const found = new Map<number, string>();
  let names: string[] = [];
  try {
    names = readdirSync(directory).filter((n) => n.endsWith(".json"));
  } catch {}
  for (const name of names) {
    try {
      const { pid, sessionId } = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (typeof pid === "number" && typeof sessionId === "string") found.set(pid, sessionId);
    } catch {}
  }
  return found;
}

/** Returns the parent process ID of process pid, or null if it can't be
 * read, as once it has ended. */
export function procParent(pid: number): number | null {
  try {
    // The name, in parentheses, may hold spaces; the parent comes after it.
    const ppid = Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" ")[1]);
    return Number.isInteger(ppid) ? ppid : null;
  } catch {
    return null;
  }
}

/** Returns the ID of the Claude session in terminal, as hc get describes
 * it, from sessions (by process ID), or undefined: the one Claude runs in
 * front, or that the program in front runs as its child, as herdr-router
 * does. parent returns a process's parent, as procParent does. */
export function terminalSession(
  terminal: any, sessions: Map<number, string>, parent: (pid: number) => number | null = procParent,
): string | undefined {
  const pid = terminal?.foreground?.pid;
  if (!pid) return undefined;
  if (sessions.has(pid)) return sessions.get(pid);
  for (const [child, session] of sessions) if (parent(child) === pid) return session;
  return undefined;
}

/** Returns the panes among terminals, each as hc get describes it with the
 * agent hc ls reports, that show in a space of the Herdr app. sessions maps
 * the process IDs of running Claude sessions to their IDs, as for
 * terminalSession with parent; herdr-core doesn't know sessions, nor
 * roles. */
export function appPaneRecords(
  terminals: any[], sessions: Map<number, string>, parent: (pid: number) => number | null = procParent,
): PaneRecord[] {
  return terminals.filter((t) => t.state === "live" && t.labels?.["herdr.space"]).map((t) => {
    const agent = AGENTS[t.agent] ?? t.agent ?? null;
    return {
      agent,
      workspace: t.labels["herdr.space"],
      cwd: t.foreground?.cwd || t.cwd || "",
      pane: t.address,
      session: agent === "claude" ? (terminalSession(t, sessions, parent) ?? "") : "",
      role: "",
    };
  });
}

/** Returns herdr-core's live terminals on this machine, each as hc get
 * describes it with the agent hc ls reports. A terminal that ends while
 * this reads it is left out, or, if all, raises instead, so that a
 * terminal missing from the list surely isn't there. */
export async function appTerminals(run: Json = json, all = false): Promise<any[]> {
  const listed: any[] = (await run("hc", ["ls", "--json"])).terminals;
  const terminals = await Promise.all(listed.map((t) =>
    run("hc", ["get", t.address, "--json"]).then((got) => ({ ...got, agent: t.agent }), (e) => {
      if (all) throw e;
      return null;
    })));
  return terminals.filter((t) => t);
}

/** Returns the panes of the Herdr app's spaces on this machine, as
 * appPaneRecords does. */
export async function appPanes(run: Json = json, sessions = claudeSessions()): Promise<PaneRecord[]> {
  return appPaneRecords(await appTerminals(run), sessions);
}

/** Returns the terminals among terminals, as appTerminals reads them, that
 * show in a space of the Herdr app, as Herdr describes its panes, so that
 * their agents count as Herdr's do. A terminal is an agent only while its
 * program reports a status. sessions and parent are as for
 * appPaneRecords. */
export function appHerdrPanes(
  terminals: any[], sessions: Map<number, string>, parent: (pid: number) => number | null = procParent,
): Herdr["panes"] {
  return terminals.filter((t) => t.state === "live" && t.labels?.["herdr.space"]).map((t) => {
    const app = t.status?.app;
    const agent = app ? (AGENTS[app] ?? app) : null;
    return {
      pane_id: t.address,
      workspace_id: t.labels["herdr.space"],
      tab_id: t.labels["herdr.tab"],
      cwd: t.foreground?.cwd || t.cwd,
      agent,
      agent_status: t.status?.state,
      agent_session: agent === "claude" ? { value: terminalSession(t, sessions, parent) ?? "" } : null,
    };
  });
}

/** Reports whether the agent in terminal, as hc get describes it, is
 * waiting for its next message. */
export function appAgentFree(terminal: any): boolean {
  return ["idle", "done"].includes(terminal?.status?.state);
}

/** Runs the Herdr app command name with args and returns what it made. */
export type AppCommand = (name: string, args: object) => Promise<any>;

const appCommand: AppCommand = (name, args) => json("herdr-app", ["do", name, JSON.stringify(args)]);

/** Returns the router among terminals, as appTerminals reads them: the
 * live terminal labeled role=router that still runs herdr-router or
 * Claude, which herdr-router runs in front, or null. */
export function routerTerminal(terminals: any[]): any | null {
  const runs = (a: string) => a === "claude" || a === "herdr-router" || a.endsWith("/herdr-router");
  return terminals.find((t) => t?.state === "live" && t.labels?.role === "router" && t.foreground?.argv?.some(runs)) ?? null;
}

/** Gives text to the router among terminals with send, or starts a
 * router in a new space with text as its task, with command. terminals
 * must be all of them, or a second router could start. Raises for a
 * router outside the app's spaces, whose state the app doesn't report,
 * so that nothing could tell when it is free for text. */
export async function toRouter(
  text: string, terminals: any[], send: (router: any, text: string) => Promise<unknown>,
  command: AppCommand = appCommand,
): Promise<void> {
  const router = routerTerminal(terminals);
  if (router && !router.labels?.["herdr.space"]) throw new Error(`the router, ${router.address}, is in no space of the app`);
  // herdr-router moves to its own folder.
  if (router) await send(router, text);
  else await command("space.new", { name: "ROUTER", folder: homedir(), argv: ["herdr-router"], task: text, machine: "" });
}

/** Returns how open opens rows in the Herdr app, with command running its
 * commands. The app starts a terminal with its program rather than typing
 * one into a shell, so a new tab or space is only made once run says what
 * runs in it. */
export function appOpener(command: AppCommand = appCommand): OpenHerdr {
  const pending = new Map<string, [string, object]>();
  const later = (name: string, args: object) => {
    const id = `pending-${pending.size + 1}`;
    pending.set(id, [name, args]);
    return id;
  };
  return {
    focus: (pane) => command("pane.focus", { terminal: pane }),
    tab: async (space, folder) => later("tab.new", { space, folder }),
    workspace: async (folder, name) => ({ workspace: "", pane: later("space.new", { folder, ...(name ? { name } : {}) }) }),
    // Spaces are named from README.md when made, and tabs need no title.
    title: async () => {},
    run: async (pane, line) => {
      const made = pending.get(pane);
      if (!made) throw new Error(`no tab or space to run in: ${pane}`);
      pending.delete(pane);
      return command(made[0], { ...made[1], argv: ["sh", "-c", line] });
    },
  };
}

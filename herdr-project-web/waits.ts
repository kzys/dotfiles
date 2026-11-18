// What agents wait on: the commands Claude Code's Bash tool still runs,
// as for CI to finish, read from the processes, and the subagents it still
// runs, read from its files. An idle agent with one is waiting for it
// rather than done.

import { execFile } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

// A process, with when it started in milliseconds since the epoch.
export type Process = { pid: number; ppid: number; started: number; command: string };

// A command and when it started, in milliseconds since the epoch, which
// stays the same while it runs, unlike how long it has run.
export type Wait = { command: string; since: number };

/** Returns the processes in text, as LC_ALL=C ps -ww -axo
 * pid=,ppid=,lstart=,command= prints them, with their start times, like
 * Tue Nov 17 12:02:36 2026, in this machine's time zone. */
export function parsePs(text: string): Process[] {
  return text.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3} +\d+ [\d:]+ \d{4})\s+(.*)$/.exec(line);
    const started = m ? Date.parse(m[3].replace(/ +/g, " ")) : NaN;
    return m && !Number.isNaN(started) ? [{ pid: Number(m[1]), ppid: Number(m[2]), started, command: m[4] }] : [];
  });
}

/** Returns the command Claude Code's Bash tool runs in the shell whose
 * command line is shell, without the cd it starts with, or null if shell
 * isn't one of its shells. */
export function toolCommand(shell: string): string | null {
  if (!shell.includes("/shell-snapshots/")) return null;
  // Quoted only if it needs to be.
  const m = /&& eval (?:'((?:[^']|'"'"')*)'|(\S+)) < \/dev\/null/.exec(shell);
  return m ? (m[1]?.replaceAll(`'"'"'`, "'") ?? m[2]).replace(/^cd \S+ && /, "") : null;
}

/** Returns what each Claude process among processes runs in its Bash
 * tool's shells, by its process ID, longest-running first. */
export function waitsByPid(processes: Process[]): Map<number, Wait[]> {
  const claude = new Set(processes.filter((p) => p.command.split(" ")[0].split("/").pop() === "claude").map((p) => p.pid));
  const found = new Map<number, Wait[]>();
  for (const p of processes) {
    const command = claude.has(p.ppid) ? toolCommand(p.command) : null;
    if (command) found.set(p.ppid, [...(found.get(p.ppid) ?? []), { command, since: p.started }]);
  }
  for (const waits of found.values()) waits.sort((a, b) => a.since - b.since);
  return found;
}

/** Returns the subagents still running in the Claude session whose files
 * are in folder, as Claude Code keeps them under ~/.claude/projects, each
 * with when it started, longest-running first. Claude Code marks a
 * subagent's metadata finished when it ends, but not always when it is
 * stopped or its session dies, so only those started since, when the
 * session's process started, in milliseconds since the epoch, count. */
export function runningSubagents(folder: string, since: number): Wait[] {
  const dir = join(folder, "subagents");
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".meta.json"));
  } catch {}
  return names.flatMap((name) => {
    try {
      const path = join(dir, name);
      const meta = JSON.parse(readFileSync(path, "utf8"));
      const at = statSync(path).mtimeMs;
      if (meta.finished || meta.stoppedByUser || at < since) return [];
      return [{ command: `${meta.agentType ?? "subagent"}: ${meta.description ?? ""}`, since: Math.floor(at) }];
    } catch {
      return [];
    }
  }).sort((a, b) => a.since - b.since);
}

/** Returns the folder under projects, ~/.claude/projects, where Claude
 * Code keeps the files of session, or null if it has none. */
export function sessionFolder(projects: string, session: string): string | null {
  let names: string[] = [];
  try {
    names = readdirSync(projects);
  } catch {}
  for (const name of names) {
    try {
      if (statSync(join(projects, name, session)).isDirectory()) return join(projects, name, session);
    } catch {}
  }
  return null;
}

/** Returns this machine's processes. */
export async function readProcesses(): Promise<Process[]> {
  const { stdout } = await promisify(execFile)("ps", ["-ww", "-axo", "pid=,ppid=,lstart=,command="], {
    env: { ...process.env, LC_ALL: "C" }, timeout: 10_000, maxBuffer: 16 << 20,
  });
  return parsePs(stdout);
}

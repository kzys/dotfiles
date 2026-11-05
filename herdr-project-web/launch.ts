// Working out how to start an agent in its project: where it runs, what
// it is told, and the command that starts it.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const AGENTS = ["claude", "codex", "opencode"] as const;
export type Agent = (typeof AGENTS)[number];

/** Returns the agent --agent selects in argv, claude by default, and the
 * other arguments. Those after -- are left alone. Raises for an agent it
 * doesn't know. */
export function parseAgent(argv: string[]): { agent: Agent; argv: string[] } {
  let agent: string = "claude";
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--") {
      rest.push(...argv.slice(i));
      break;
    }
    if (argv[i] === "--agent") agent = argv[++i] ?? "";
    else if (argv[i].startsWith("--agent=")) agent = argv[i].slice("--agent=".length);
    else rest.push(argv[i]);
  }
  if (!AGENTS.includes(agent as Agent)) throw new Error(`no such agent: ${agent}`);
  return { agent: agent as Agent, argv: rest };
}

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** Returns the project directory directly under projects that holds cwd,
 * or null if cwd isn't in one. Symlinks in either path don't matter. */
export function projectDir(cwd: string, projects: string): string | null {
  const inside = relative(real(projects), real(cwd));
  if (!inside || inside.startsWith("..")) return null;
  return join(projects, inside.split("/")[0]);
}

/** Returns where an agent started in cwd with argv runs, as the directory,
 * or null for a new project under projects, and the directory it was
 * started from, which it should also work in, or null. Only a new
 * session, started with no arguments, outside a project gets one;
 * anything else, such as resuming a session, stays in cwd. It works in
 * cwd unless that is home or projects itself, where nothing in particular
 * is. */
export function startIn(cwd: string, projects: string, home: string, argv: string[]): [string | null, string | null] {
  if (argv.length || projectDir(cwd, projects)) return [cwd, null];
  return [null, [real(home), real(projects)].includes(real(cwd)) ? null : cwd];
}

/** Creates a new project directory under projects, named for the date of
 * now, and returns it. */
export function newProject(projects: string, now: Date): string {
  mkdirSync(projects, { recursive: true });
  const pad = (n: number) => String(n).padStart(2, "0");
  return mkdtempSync(join(projects, `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-`));
}

/** Returns now as the instructions give it, like 2026-10-16 14:50 PDT. */
export function startTime(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ${zone}`;
}

/** Returns the instructions in PROJECT.md of the dotfiles checkout,
 * followed by those in its work/PROJECT.md if it has it, filling in the
 * project's directory, now as the session's start time and the checkout's
 * directory. work/ is gitignored, so it can hold private rules. */
export function instructions(directory: string, dotfiles: string, now: Date): string {
  let text = readFileSync(join(dotfiles, "PROJECT.md"), "utf8");
  try {
    text += `\n${readFileSync(join(dotfiles, "work/PROJECT.md"), "utf8")}`;
  } catch {}
  return text.replaceAll("$PWD", () => directory).replaceAll("$start", () => startTime(now)).replaceAll("$dotfiles", () => dotfiles);
}

export type Command = { program: string; args: string[]; env: Record<string, string> };

/** Reports whether process pid exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Returns the command that starts agent in directory, passing it argv.
 * origin is the directory it was started from, outside its project, which
 * it may also work in, or null. OpenCode reads instructions only from
 * files, so for it they are written to one named after pid, the process
 * that becomes the agent, under stateDir, removing those of agents that
 * have exited. OpenCode isn't given origin or the dotfiles checkout as
 * extra directories; it asks before working outside its project. */
export function agentCommand(
  agent: Agent, argv: string[], directory: string, origin: string | null,
  { dotfiles, stateDir, pid, now }: { dotfiles: string; stateDir: string; pid: number; now: Date },
): Command {
  let text = instructions(directory, dotfiles, now);
  const extra: string[] = [];
  const env: Record<string, string> = { CLAUDE_CODE_SHELL: "/bin/bash" };
  if (origin) {
    text += `\n\nThis session was started in \`${origin}\`, outside ~/project, so this task's directory was made for it. `
      + `Work on what is in \`${origin}\` as Checkouts says, keeping your notes here.`;
    extra.push("--add-dir", origin);
    // Claude reads CLAUDE.md files of added directories only if asked.
    env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD = "1";
  }
  if (agent === "codex") {
    // --resume is the picker's common spelling; Codex uses a subcommand.
    const args = argv[0] === "--resume" ? ["resume", ...argv.slice(1)] : argv;
    // Codex doesn't expand imports, so give it a path it can open.
    const rules = readFileSync(join(dotfiles, "config/opencode/AGENTS.md"), "utf8").replaceAll("@../../", () => `@${dotfiles}/`);
    return {
      program: "codex",
      // Scratch projects may be untrusted, where Codex defaults to read-only
      // permissions and rejects additional writable roots.
      args: ["--sandbox", "workspace-write", "--add-dir", dotfiles, ...extra,
             "-c", `developer_instructions=${JSON.stringify(`${rules}\n\n${text}`)}`, ...args],
      env: {},
    };
  }
  if (agent === "opencode") {
    // --resume is the picker's common spelling.
    const args = argv[0] === "--resume" ? ["--session", ...argv.slice(1)] : argv;
    // It reads the dotfiles' rules from ~/.config/opencode/AGENTS.md already.
    const folder = join(stateDir, "opencode");
    mkdirSync(folder, { recursive: true });
    for (const name of readdirSync(folder)) {
      const old = /^(\d+)\.md$/.exec(name);
      if (old && !alive(Number(old[1]))) rmSync(join(folder, name), { force: true });
    }
    const path = join(folder, `${pid}.md`);
    writeFileSync(path, `${text}\n`);
    return { program: "opencode", args, env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ instructions: [path] }) } };
  }
  return { program: "claude", args: ["--add-dir", dotfiles, ...extra, "--append-system-prompt", text, ...argv], env };
}

/** Returns text quoted for a POSIX shell. */
export const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/** Returns a shell script that replaces the shell with command, in
 * directory, so that the agent is the pane's own process. */
export function launchScript(directory: string, { program, args, env }: Command): string {
  const exports = Object.entries(env).map(([k, v]) => `export ${k}=${quote(v)}\n`).join("");
  return `cd ${quote(directory)} || exit 1\n${exports}exec ${[program, ...args].map(quote).join(" ")}\n`;
}

/** Returns the directory an agent should start in with argv and whether
 * it needs a new project, creating it. See startIn. */
export function launchDirectory(cwd: string, projects: string, home: string, argv: string[], now: Date): [string, string | null] {
  const [directory, origin] = startIn(cwd, projects, home, argv);
  return [directory ?? newProject(projects, now), origin];
}


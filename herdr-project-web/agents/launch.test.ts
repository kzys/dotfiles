import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  agentCommand, launchDirectory, launchScript, newProject, parseAgent, projectDir, quote, startIn,
} from "./launch.ts";

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "launch-")));
const now = new Date(2026, 10, 4, 9, 5);

function dotfiles() {
  const dir = temp();
  writeFileSync(join(dir, "PROJECT.md"), "the rules\n");
  mkdirSync(join(dir, "config/opencode"), { recursive: true });
  writeFileSync(join(dir, "config/opencode/AGENTS.md"), "@../../rules\n");
  return dir;
}

test("selects the agent, leaving the rest and what follows --", () => {
  assert.deepEqual(parseAgent([]), { agent: "claude", argv: [] });
  assert.deepEqual(parseAgent(["--agent", "codex", "--resume", "x"]), { agent: "codex", argv: ["--resume", "x"] });
  assert.deepEqual(parseAgent(["--agent=codex", "--", "--agent", "other"]), { agent: "codex", argv: ["--", "--agent", "other"] });
  assert.throws(() => parseAgent(["--agent", "nobody"]));
});

test("finds the project holding a directory, through symlinks", () => {
  const root = temp();
  mkdirSync(join(root, "p/sub"), { recursive: true });
  symlinkSync(join(root, "p"), join(root, "link"));
  assert.equal(projectDir(join(root, "p/sub"), root), join(root, "p"));
  assert.equal(projectDir(root, root), null);
  assert.equal(projectDir(tmpdir(), root), null);
  assert.equal(projectDir(join(root, "_router"), root), null);
  assert.equal(projectDir(join(root, ".hidden/sub"), root), null);
});

test("starts new sessions outside a project in a new one", () => {
  const home = temp();
  const projects = join(home, "project");
  const work = join(home, "work");
  mkdirSync(join(projects, "p"), { recursive: true });
  mkdirSync(work);
  assert.deepEqual(startIn(work, projects, home, []), [null, work]);
  assert.deepEqual(startIn(home, projects, home, []), [null, null]);
  assert.deepEqual(startIn(projects, projects, home, []), [null, null]);
  assert.deepEqual(startIn(join(projects, "p"), projects, home, []), [join(projects, "p"), null]);
  assert.deepEqual(startIn(work, projects, home, ["--resume", "s"]), [work, null]);
  assert.deepEqual(startIn(home, projects, home, ["fix the login bug"]), [null, null]);
  assert.deepEqual(startIn(work, projects, home, ["fix the login bug"]), [null, work]);
});

test("creates a project named for the date", () => {
  const projects = join(temp(), "project");
  assert.match(newProject(projects, now), /\/20261104-[^/]+$/);
  const [dir, origin] = launchDirectory(join(projects, ".."), projects, join(projects, ".."), [], now);
  assert.ok(existsSync(dir));
  assert.equal(origin, null);
  assert.equal(readdirSync(projects).length, 2);
});

const options = (dir: string, stateDir = temp()) => ({ dotfiles: dir, stateDir, pid: process.pid });

test("starts Claude with PROJECT.md and its origin", () => {
  const dir = dotfiles();
  const plain = agentCommand("claude", ["--resume", "s"], "/p", null, options(dir));
  assert.equal(plain.program, "claude");
  assert.deepEqual(plain.args, ["--add-dir", dir, "--append-system-prompt-file", join(dir, "PROJECT.md"), "--resume", "s"]);
  assert.deepEqual(plain.env, { CLAUDE_CODE_SHELL: "/bin/bash" });
  const from = agentCommand("claude", [], "/p", "/work", options(dir));
  assert.deepEqual(from.args.slice(2, 7),
                   ["--add-dir", "/work", "--append-system-prompt-file", join(dir, "PROJECT.md"), "--append-system-prompt"]);
  assert.match(from.args.at(-1)!, /launched from `\/work`.*notes in `\/p`/);
  assert.equal(from.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD, "1");
});

test("starts Codex with the rules and its own way to resume", () => {
  const dir = dotfiles();
  const { program, args } = agentCommand("codex", ["--resume", "s"], "/p", null, options(dir));
  assert.equal(program, "codex");
  assert.deepEqual(args.slice(-2), ["resume", "s"]);
  const instructed = args[args.indexOf("-c") + 1];
  assert.ok(instructed.includes(`@${dir}/rules`));
  const from = agentCommand("codex", [], "/p", "/work", options(dir));
  assert.match(from.args[from.args.indexOf("-c") + 1], /launched from `\/work`/);
});

test("gives OpenCode its instructions in a file, removing dead agents' files", () => {
  const dir = dotfiles();
  const state = temp();
  mkdirSync(join(state, "opencode"));
  writeFileSync(join(state, "opencode/99999999.md"), "old");
  const { program, args, env } = agentCommand("opencode", ["--resume", "s"], "/p", null, options(dir, state));
  assert.equal(program, "opencode");
  assert.deepEqual(args, ["--session", "s"]);
  const [path] = JSON.parse(env.OPENCODE_CONFIG_CONTENT).instructions;
  assert.match(readFileSync(path, "utf8"), /^the rules/);
  assert.deepEqual(readdirSync(join(state, "opencode")), [`${process.pid}.md`]);
  // With the private rules and an origin.
  mkdirSync(join(dir, "work"));
  writeFileSync(join(dir, "work/PROJECT.md"), "private\n");
  const from = agentCommand("opencode", [], "/p", "/work", options(dir, state));
  const files = JSON.parse(from.env.OPENCODE_CONFIG_CONTENT).instructions;
  assert.deepEqual(files.slice(1), [join(dir, "work/PROJECT.md")]);
  assert.match(readFileSync(files[0], "utf8"), /launched from `\/work`/);
});

test("a shell runs the script as given", () => {
  const dir = temp();
  const tricky = `it's "a" $HOME \`x\`\nline`;
  const script = launchScript(dir, { program: "sh", args: ["-c", 'printf "%s|%s|%s" "$PWD" "$V" "$1"', "sh", tricky], env: { V: tricky } });
  assert.equal(execFileSync("sh", ["-c", script], { encoding: "utf8" }), `${dir}|${tricky}|${tricky}`);
  assert.equal(quote("a'b"), `'a'\\''b'`);
});

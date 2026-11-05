import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  agentCommand, instructions, launchDirectory, launchScript, newProject, parseAgent, projectDir, quote, startIn, startTime,
} from "./launch.ts";

const temp = () => realpathSync(mkdtempSync(join(tmpdir(), "launch-")));
const now = new Date(2026, 10, 4, 9, 5);

function dotfiles() {
  const dir = temp();
  writeFileSync(join(dir, "PROJECT.md"), "in $PWD since $start, from $dotfiles\n");
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
});

test("creates a project named for the date", () => {
  const projects = join(temp(), "project");
  assert.match(newProject(projects, now), /\/20261104-[^/]+$/);
  const [dir, origin] = launchDirectory(join(projects, ".."), projects, join(projects, ".."), [], now);
  assert.ok(existsSync(dir));
  assert.equal(origin, null);
  assert.equal(readdirSync(projects).length, 2);
});

test("gives the time with its zone", () => {
  assert.match(startTime(now), /^2026-11-04 09:05 \S+$/);
});

test("fills in the instructions and adds the private ones", () => {
  const dir = dotfiles();
  assert.equal(instructions("/p", dir, now), `in /p since ${startTime(now)}, from ${dir}\n`);
  mkdirSync(join(dir, "work"));
  writeFileSync(join(dir, "work/PROJECT.md"), "private\n");
  assert.match(instructions("/p", dir, now), /\n\nprivate\n$/);
});

const options = (dir: string, stateDir = temp()) => ({ dotfiles: dir, stateDir, pid: process.pid, now });

test("takes a directory as it is, even with $ in it", () => {
  assert.match(instructions("/a/$&b", dotfiles(), now), /^in \/a\/\$&b since/);
});

test("starts Claude with its instructions and origin", () => {
  const dir = dotfiles();
  const plain = agentCommand("claude", ["--resume", "s"], "/p", null, options(dir));
  assert.equal(plain.program, "claude");
  assert.deepEqual(plain.args.slice(0, 3), ["--add-dir", dir, "--append-system-prompt"]);
  assert.deepEqual(plain.args.slice(-2), ["--resume", "s"]);
  assert.deepEqual(plain.env, { CLAUDE_CODE_SHELL: "/bin/bash" });
  const from = agentCommand("claude", [], "/p", "/work", options(dir));
  assert.deepEqual(from.args.slice(2, 4), ["--add-dir", "/work"]);
  assert.match(from.args.at(-1)!, /started in `\/work`/);
  assert.equal(from.env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD, "1");
});

test("starts Codex with the rules and its own way to resume", () => {
  const dir = dotfiles();
  const { program, args } = agentCommand("codex", ["--resume", "s"], "/p", null, options(dir));
  assert.equal(program, "codex");
  assert.deepEqual(args.slice(-2), ["resume", "s"]);
  const instructed = args[args.indexOf("-c") + 1];
  assert.ok(instructed.includes(`@${dir}/rules`));
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
  assert.match(readFileSync(path, "utf8"), /^in \/p/);
  assert.deepEqual(readdirSync(join(state, "opencode")), [`${process.pid}.md`]);
});

test("a shell runs the script as given", () => {
  const dir = temp();
  const tricky = `it's "a" $HOME \`x\`\nline`;
  const script = launchScript(dir, { program: "sh", args: ["-c", 'printf "%s|%s|%s" "$PWD" "$V" "$1"', "sh", tricky], env: { V: tricky } });
  assert.equal(execFileSync("sh", ["-c", script], { encoding: "utf8" }), `${dir}|${tricky}|${tricky}`);
  assert.equal(quote("a'b"), `'a'\\''b'`);
});

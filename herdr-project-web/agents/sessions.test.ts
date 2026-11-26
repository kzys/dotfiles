import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { claudeSessionDirs, codexContext, codexSessionDirs, codexSessions, reportedRole, title, transcriptDir, transcripts } from "./sessions.ts";

const temp = () => mkdtempSync(join(tmpdir(), "sessions-"));
const lines = (...records: object[]) => records.map((r) => JSON.stringify(r)).join("\n") + "\n";

test("lists a directory's transcripts, newest first", () => {
  const home = temp();
  const dir = transcriptDir("/a/b.c", home);
  assert.match(dir, /\/\.claude\/projects\/-a-b-c$/);
  assert.deepEqual(transcripts("/a/b.c", home), []);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "old.jsonl"), "");
  writeFileSync(join(dir, "new.jsonl"), "");
  writeFileSync(join(dir, "skip.txt"), "");
  utimesSync(join(dir, "old.jsonl"), 1, 1);
  assert.deepEqual(transcripts("/a/b.c", home).map((t) => t.id), ["new", "old"]);
});

test("prefers the title it was renamed to, then the generated one, then the prompt", () => {
  const path = join(temp(), "s.jsonl");
  const ai = { type: "ai-title", aiTitle: "Generated" };
  const custom = { type: "custom-title", customTitle: "Renamed" };
  writeFileSync(path, lines({ lastPrompt: "  a\n prompt " }));
  assert.equal(title(path), "a prompt");
  writeFileSync(path, lines({ lastPrompt: "x" }, ai));
  assert.equal(title(path), "Generated");
  writeFileSync(path, lines(custom, ai));
  assert.equal(title(path), "Renamed");
  writeFileSync(path, "");
  assert.equal(title(path), "");
});

test("finds a title before the tail it reads first", () => {
  const path = join(temp(), "s.jsonl");
  writeFileSync(path, lines({ type: "ai-title", aiTitle: "Early" }, { filler: "x".repeat(500) }));
  assert.equal(title(path, 100), "Early");
});

const report = (role: string) => ({ message: { content: [{
  type: "tool_use", input: { command: `herdr pane report-metadata "$HERDR_PANE_ID" --source agent-notes --token role=${role}` },
}] } });

test("finds the role a session last reported", () => {
  const path = join(temp(), "s.jsonl");
  writeFileSync(path, lines(report("first"), { message: "report-metadata" }, report("main")));
  assert.equal(reportedRole(path), "main");
  assert.equal(reportedRole(join(temp(), "none.jsonl")), null);
});

test("reads Codex's newest state database, skipping archived sessions and subagents", () => {
  const home = temp();
  for (const [n, id] of [[1, "stale"], [5, "main"]] as const) {
    const db = new DatabaseSync(join(home, `state_${n}.sqlite`));
    db.exec("CREATE TABLE threads (id TEXT, cwd TEXT, updated_at INT, archived INT, source TEXT)");
    const add = db.prepare("INSERT INTO threads VALUES (?, '/p', ?, ?, ?)");
    add.run(id, 2, 0, "cli");
    add.run("archived", 3, 1, "cli");
    add.run("sub", 4, 0, '{"subagent":1}');
    db.close();
  }
  assert.deepEqual(codexSessions(home).map((s) => s.id), ["main"]);
});

test("falls back to Codex's rollouts", () => {
  const home = temp();
  mkdirSync(join(home, "sessions/2026"), { recursive: true });
  writeFileSync(join(home, "session_index.jsonl"), lines({ id: "r1", thread_name: "Named" }));
  writeFileSync(join(home, "sessions/2026/a.jsonl"), lines({ type: "session_meta", payload: { id: "r1", cwd: "/p", source: "cli" } }));
  writeFileSync(join(home, "sessions/2026/b.jsonl"), lines({ type: "other" }));
  const [session, ...rest] = codexSessions(home);
  assert.equal(session.title, "Named");
  assert.deepEqual(rest, []);
  assert.deepEqual(codexSessions(join(home, "missing")), []);
});

test("reads the context usage from a rollout's last count", () => {
  const path = join(temp(), "r.jsonl");
  const count = (used: number) => ({ payload: { type: "token_count", info: { model_context_window: 200, last_token_usage: { total_tokens: used } } } });
  writeFileSync(path, lines(count(20), count(50), { payload: {} }));
  assert.equal(codexContext(path), 25);
  assert.equal(codexContext(join(temp(), "none")), null);
});

test("lists the directories sessions ran in, newest first, once each", () => {
  const home = temp();
  const dir = join(home, ".claude/projects/-x");
  mkdirSync(dir, { recursive: true });
  const record = (cwd: string, at: string) => ({ cwd, gitBranch: "main", timestamp: at });
  writeFileSync(join(dir, "a.jsonl"), lines(record("/a", "2026-01-01"), { type: "ai-title", aiTitle: "Old" }));
  writeFileSync(join(dir, "b.jsonl"), lines({ type: "ai-title", aiTitle: "New" }, record("/a", "2026-03-01")));
  writeFileSync(join(dir, "c.jsonl"), lines(record("/b", "2026-02-01")));
  assert.deepEqual(claudeSessionDirs(home).map((d) => [d.cwd, d.title]), [["/a", "New"], ["/b", ""]]);
});

test("lists Codex's directories once each", () => {
  const dirs = codexSessionDirs([
    { id: "1", cwd: "/a", updated_at: 2, name: "  New  one " }, { id: "2", cwd: "/a", updated_at: 1 }, { id: "3", cwd: "/b", updated_at: 0, git_branch: "x" },
  ]);
  assert.deepEqual(dirs.map((d) => [d.cwd, d.title, d.branch]), [["/a", "New one", ""], ["/b", "", "x"]]);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDiff, splitRows, unquote } from "./diff.ts";
import { HerdrEvents, subscriptions } from "./events.ts";
import { halMessage } from "./hal.ts";
import { highlight, language } from "./highlight.ts";
import { linkParts, projectItems, uniqueKeys, waiting, watchedItems } from "./inbox.ts";
import { agentState, readiness } from "./pulls.ts";
import {
  type PullRequest, agentStates, namedCheckouts, pullRequestLinks, readState, workspaceLabels,
} from "./state.ts";
import { checkoutDirs, summarize, worktreeDiff, worktreeDirs } from "./worktrees.ts";

test("guesses what waits on me as inbox.py does", () => {
  assert.deepEqual(
    [
      "Apply the change to staging (user)", "Cleanup left (ask): branches",
      "Agree on the design with the user", "Rollout not decided yet", "Branch is local only",
      "Offer: file a ticket", "Post outcome in the thread if user wants",
      "Rerun 4 timed-out clusters", "Unverified: GPU containers work",
      "[ ] Decide on the rollout", "[x] Decide on the rollout", "Is the user okay to push?",
      "Offers to file a ticket", "Wrote notes for the user", "Shared summary with the user",
      "PR approved, waiting on CI", "Decision: went with B", "Needs approval from the owner",
      "Confirm the plan with the user", "[you] Push it",
    ].map(waiting), [
    "?", "?", "?", "?", "?", "maybe", "maybe", null, null,
    "?", null, "?", "maybe", null, null, null, null, "?", "?", "you",
  ]);
});

test("closes roles and then the project", () => {
  const a = "closed: https://x/pull/1\n\n## Remaining\n- [you] Stale\n\n## Findings\n- etcd needs 3\n";
  const b = "## Remaining\n- None.\n";
  const c = "## Remaining\n- [you] Decide X\n\n## Log\n- closed: no\n";
  const notes: [string, string][] = [["a", a], ["b", b], ["c", c]];
  assert.deepEqual(projectItems("/p", null, notes).map((i) => [i.role, i.mark, i.text]), [
    ["c", "you", "Decide X"],
    ["b", "close", "Nothing remaining for b; tell its agent its part is done to close it"],
  ]);
  // The watcher's items hold the suggestions back.
  const watched = [{ project: "/p", role: null, mark: "pr", text: "app#1 failed" }];
  assert.deepEqual(projectItems("/p", null, notes, watched).map((i) => i.mark), ["you", "pr"]);

  notes[2][1] = "closed: decided X\n\n## Remaining\n";
  assert.deepEqual(projectItems("/p", null, notes).map((i) => i.text), [
    "Nothing remaining; tell its agent the task is done to close it",
  ]);
  assert.deepEqual(projectItems("/p", "---\nclosed: done\n---\n", notes), []);
  // Notes with CRLF line ends read the same.
  const crlf: [string, string][] = notes.map(([r, t]) => [r, t.replaceAll("\n", "\r\n")]);
  assert.deepEqual(projectItems("/p", null, crlf), projectItems("/p", null, notes));
});

test("skips watched items not in the watcher's form", () => {
  assert.deepEqual(
    watchedItems({
      Panes: [{ project: null, role: null, mark: "idle", text: "idle" }, { mark: "x" }, 3],
      Slack: "junk",
    }), [{ project: null, role: null, mark: "idle", text: "idle" }]);
  assert.deepEqual(watchedItems([]), []);
});

test("reads the watcher's files and the projects' notes", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const state = join(root, "state");
  const projects = join(root, "project");
  const p1 = join(projects, "20261018-a");
  const p2 = join(projects, "20261017-b");
  const p3 = join(projects, "20261019-z");
  const closed = join(projects, "20261016-c");
  const hidden = join(projects, ".trash");
  for (const d of [state, p1, p2, p3, closed, hidden]) mkdirSync(d, { recursive: true });
  writeFileSync(join(closed, "README.md"), "---\nclosed: done\n---\n");
  writeFileSync(join(hidden, "AGENT-main.md"), "## Remaining\n- [you] Old\n");
  writeFileSync(join(p1, "README.md"), "---\ntitle: Do A\nname: a\n---\n");
  writeFileSync(join(p1, "AGENT-main.md"), "## Remaining\n- [you] Pick one\n");
  writeFileSync(join(p2, "AGENT-main.md"), "## Remaining\n- [wait] CI\n");
  mkdirSync(join(p1, "repo"));
  writeFileSync(join(p1, "repo", ".git"), "gitdir: elsewhere\n");
  mkdirSync(join(p1, "logs"));
  writeFileSync(
    join(state, "screen.json"),
    JSON.stringify([{ title: "Panes", at: null, lines: ["90% w1:p1 a"] }]),
  );
  writeFileSync(
    join(state, "inbox.json"),
    JSON.stringify({
      Panes: [{ project: p1, role: "main", mark: "ctx", text: "context 90% full" }],
      Slack: [{ project: join(projects, "gone"), role: null, mark: "slack", text: "hi" },
              { project: null, role: null, mark: "slack", text: "dm" }],
      "Pull requests": [{ project: closed, role: null, mark: "pr", text: "c#1 failed" }],
    }),
  );

  const s = readState(state, projects);
  assert.deepEqual(s.sections, [{ title: "Panes", at: null, lines: ["90% w1:p1 a"] }]);
  assert.notEqual(s.watchedAt, null);
  assert.deepEqual(s.projects.map((p) => [p.name, p.title, p.worktrees, p.items.map((i) => i.text)]), [
    ["a", "Do A", [join(p1, "repo")], ["Pick one", "context 90% full"]],
    ["20261019-z", "(no title)", [], []],
    ["20261017-b", "(no title)", [], []],
  ]);
  // Projects open in Herdr come before the quiet ones too.
  const herdr = { workspaces: [{ workspace_id: "w1", label: "bee" }],
                  panes: [{ pane_id: "w1:p1", workspace_id: "w1", cwd: p2 }] };
  assert.deepEqual(readState(state, projects, herdr).projects.map((p) => [p.name, p.workspaces]), [
    ["a", []], ["20261017-b", ["bee"]], ["20261019-z", []],
  ]);
  assert.deepEqual(s.unowned.map((i) => i.text), ["hi", "dm", "c#1 failed"]);

  assert.deepEqual(readState(join(root, "none"), join(root, "none")), {
    sections: null, watchedAt: null, projects: [], unowned: [], links: {}, agents: null,
  });
});

test("finds the checkouts that notes name", () => {
  assert.deepEqual(
    namedCheckouts(
      "Work in ~/repos/kzys/dotfiles. See /home/u/repos/a/b-c/sub and ~/repos/kzys/dotfiles/x.\n" +
        "Not ~/repos/<org>/<repo>, ~/repos/a/.. or /other/repos/x/y.",
      "/home/u",
    ),
    ["/home/u/repos/kzys/dotfiles", "/home/u/repos/a/b-c"],
  );
});

test("lists the checkouts a project works in after its worktrees", () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const projects = join(root, "project");
  const [p1, p2] = [join(projects, "20261018-a"), join(projects, "20261017-b")];
  for (const d of [join(p1, "wt"), p2, join(root, "repos/o/r1"), join(root, "repos/o/r2")])
    mkdirSync(d, { recursive: true });
  for (const d of [join(p1, "wt"), join(root, "repos/o/r1"), join(root, "repos/o/r2")])
    writeFileSync(join(d, ".git"), "gitdir: elsewhere\n");
  // The field wins over what the notes name.
  writeFileSync(join(p1, "README.md"), "---\nrepositories: ~/repos/o/r2 ~/repos/o/gone\n---\nIn ~/repos/o/r1.\n");
  writeFileSync(join(p1, "AGENT-main.md"), "## Remaining\n- [you] Pick one\n");
  writeFileSync(join(p2, "AGENT-main.md"), "## Remaining\n- [you] Check ~/repos/o/r1\n");

  const s = readState(join(root, "state"), projects, null, root);
  assert.deepEqual(s.projects.map((p) => p.worktrees), [
    [join(p1, "wt"), join(root, "repos/o/r2")],
    [join(root, "repos/o/r1")],
  ]);
});

test("names the workspaces with panes in a project", () => {
  const herdr = {
    workspaces: [{ workspace_id: "w1", label: "custom" }, { workspace_id: "w2" },
                 { workspace_id: "w3", label: "other" }],
    panes: [{ pane_id: "w1:p1", workspace_id: "w1", cwd: "/p/a/wt" },
            { pane_id: "w2:p1", workspace_id: "w2", cwd: "/home", foreground_cwd: "/p/a" },
            { pane_id: "w3:p1", workspace_id: "w3", cwd: "/p/ab" }],
  };
  assert.deepEqual(workspaceLabels("/p/a", herdr), ["custom", "w2"]);
  assert.deepEqual(workspaceLabels("/p/a", null), []);
});

test("links pull requests by their labels", () => {
  const links = pullRequestLinks({
    "https://github.com/kzys/dotfiles/pull/80": { state: "OPEN" },
    "https://github.com/kzys/containerd/pull/12": { state: "OPEN" },
    "https://github.com/containerd/containerd/pull/12": { state: "OPEN" },
    "https://example.com/x": {},
  });
  assert.deepEqual(links, {
    "kzys/dotfiles#80": "https://github.com/kzys/dotfiles/pull/80",
    "dotfiles#80": "https://github.com/kzys/dotfiles/pull/80",
    "kzys/containerd#12": "https://github.com/kzys/containerd/pull/12",
    "containerd/containerd#12": "https://github.com/containerd/containerd/pull/12",
  });
  assert.deepEqual(pullRequestLinks(null), {});

  assert.deepEqual(linkParts("✓ ● dotfiles#80     dotfiles   Add it", links), [
    ["✓ ● "], ["dotfiles#80", "https://github.com/kzys/dotfiles/pull/80"],
    ["     dotfiles   Add it"]]);
  // A label two pull requests share links only with its owner.
  assert.deepEqual(linkParts("containerd#12 and containerd/containerd#12", links), [
    ["containerd#12"], [" and "],
    ["containerd/containerd#12", "https://github.com/containerd/containerd/pull/12"]]);
  // Another owner's pull request with the same name isn't this one.
  assert.deepEqual(linkParts("other/dotfiles#80 is done", links), [
    ["other/dotfiles#80"], [" is done"]]);
  assert.deepEqual(linkParts("see https://x.test/pull/1#c-2) or x#1", links), [
    ["see "], ["https://x.test/pull/1#c-2", "https://x.test/pull/1#c-2"], [") or "], ["x#1"]]);
  assert.deepEqual(linkParts("__proto__#1 constructor", links), [["__proto__#1"], [" constructor"]]);
});

test("has HAL say what needs attention first", () => {
  const ok = { connected: true, running: true, stale: false, waiting: 0, hour: 9 };
  assert.equal(halMessage(ok), "Good morning. All systems functional. Nothing requires your attention.");
  assert.equal(halMessage({ ...ok, waiting: 1, hour: 20 }), "Good evening. One matter requires your attention.");
  assert.equal(halMessage({ ...ok, waiting: 3, hour: 2 }), "Working late. 3 matters require your attention.");
  assert.match(halMessage({ ...ok, stale: true, waiting: 3 }), /stopped reporting/);
  assert.match(halMessage({ ...ok, running: false, stale: true }), /isn't running/);
  assert.match(halMessage({ ...ok, connected: false, running: false }), /lost contact/);
});

test("numbers repeated keys", () => {
  assert.deepEqual(uniqueKeys(["a", "b", "a", "a"]), ["a", "b", "a#1", "a#2"]);
});

test("says where a pull request stands", () => {
  const pr: PullRequest = {
    url: "u", repo: "o/r", number: 1, label: "r#1", title: "t", draft: false,
    checks: "SUCCESS", failed: [], review: null, project: null, agent: false,
    runs: [{ name: "a", state: "passed", url: null }, { name: "b", state: "skipped", url: null }],
  };
  const running = [...pr.runs!, { name: "c", state: "running" as const, url: null }];
  const failed = [...running, { name: "d", state: "failed" as const, url: null }];
  assert.deepEqual(readiness(pr), ["ready for review", "ok"]);
  assert.deepEqual(readiness({ ...pr, review: "APPROVED" }), ["ready to merge", "done"]);
  assert.deepEqual(readiness({ ...pr, runs: running }), ["checks running", "wait"]);
  assert.deepEqual(readiness({ ...pr, runs: failed }), ["checks failing", "bad"]);
  assert.deepEqual(readiness({ ...pr, runs: failed, review: "CHANGES_REQUESTED" }),
                   ["changes requested", "bad"]);
  assert.deepEqual(readiness({ ...pr, runs: failed, draft: true }), ["draft", "wait"]);
  // A cancelled check fails GitHub's rollup but isn't failing here.
  const cancelled = [...pr.runs!, { name: "c", state: "cancelled" as const, url: null }];
  assert.deepEqual(readiness({ ...pr, runs: cancelled, checks: "FAILURE" }), ["ready for review", "ok"]);
  // Watchers that don't keep each check still give their rollup.
  assert.deepEqual(readiness({ ...pr, runs: undefined, checks: "PENDING" }), ["checks running", "wait"]);
});

test("tells a pull request still worked on from one that is ready", () => {
  const pr: PullRequest = {
    url: "u", repo: "o/r", number: 1, label: "r#1", title: "t", draft: false,
    checks: "SUCCESS", failed: [], review: null, project: null, agent: true, pane: "w1:p1",
    runs: [{ name: "a", state: "passed", url: null }],
  };
  assert.equal(agentState(pr, { "w1:p1": "working" }), "working");
  assert.equal(agentState(pr, { "w1:p1": "done" }), "idle");
  assert.equal(agentState(pr, { "w1:p1": "starting" }), "unknown");
  // Its pane has closed.
  assert.equal(agentState(pr, {}), null);
  // Herdr couldn't be asked, or the watcher only guessed the pane.
  assert.equal(agentState(pr, null), "unknown");
  assert.equal(agentState({ ...pr, pane: null }, { "w1:p1": "working" }), "unknown");
  assert.equal(agentState({ ...pr, agent: false, pane: null }, {}), null);

  assert.deepEqual(agentStates({
    workspaces: [],
    panes: [
      { pane_id: "w1:p1", workspace_id: "w1", agent: "claude", agent_status: "working" },
      { pane_id: "w1:p2", workspace_id: "w1", agent: null, agent_status: "unknown" },
    ],
  }), { "w1:p1": "working" });
  assert.equal(agentStates(null), null);

  assert.deepEqual(readiness(pr, "working"), ["agent working", "wait"]);
  assert.deepEqual(readiness(pr, "idle"), ["ready for review", "ok"]);
  assert.deepEqual(readiness({ ...pr, review: "APPROVED" }, "working"), ["agent working", "wait"]);
  // Failing checks matter more than the agent being at work on them.
  assert.deepEqual(readiness({ ...pr, checks: "FAILURE", runs: undefined }, "working"),
                   ["checks failing", "bad"]);
  // An agent waiting on the user matters most.
  assert.deepEqual(readiness({ ...pr, draft: true }, "blocked"), ["agent needs you", "bad"]);
});

test("subscribes to each agent pane's state and to lifecycle events", () => {
  const subs = subscriptions({
    workspaces: [],
    panes: [
      { pane_id: "w2:p1", workspace_id: "w2", agent: "claude" },
      { pane_id: "w1:p1", workspace_id: "w1", agent: null },
      { pane_id: "w1:p2", workspace_id: "w1", agent: "codex" },
    ],
  }) as { type: string; pane_id?: string }[];
  assert.deepEqual(subs.filter((s) => s.pane_id), [
    { type: "pane.agent_status_changed", pane_id: "w1:p2" },
    { type: "pane.agent_status_changed", pane_id: "w2:p1" },
  ]);
  assert.ok(subs.some((s) => s.type === "pane.closed"));
  // Without Herdr, there are only the lifecycle events.
  assert.ok(subscriptions(null).every((s) => !("pane_id" in s)));
});

test("reads Herdr again on its events, and subscribes again when they fail", async () => {
  // A stand-in for Herdr's socket that answers each subscription as told.
  const path = join(mkdtempSync(join(tmpdir(), "herdr-events-")), "herdr.sock");
  const requests: string[] = [];
  const replies = ['{"id":"watch","result":{"type":"subscription_started"}}\n{"data":{"pane_id":"w1:p1"}}\n'];
  const server = createServer((socket) => {
    socket.on("data", (d) => {
      requests.push(d.toString());
      socket.write(replies.shift() ?? '{"id":"watch","error":{"code":"pane_not_found"}}\n');
    });
  });
  await new Promise<void>((done) => server.listen(path, done));
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  };

  let changes = 0;
  const herdr = { workspaces: [], panes: [{ pane_id: "w1:p1", workspace_id: "w1", agent: "claude" }] };
  const events = new HerdrEvents(async () => path, () => changes++, 20);
  try {
    events.update(herdr);
    // Once on subscribing, and once on the event.
    await until(() => changes === 2);
    assert.equal(changes, 2);
    assert.match(requests[0], /"pane_id":"w1:p1"/);

    // The same panes need no new subscription.
    events.update(herdr);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(requests.length, 1);

    // New agent panes do; refused, it asks for a read after retryMs.
    events.update({ ...herdr, panes: [...herdr.panes, { pane_id: "w2:p1", workspace_id: "w2", agent: "codex" }] });
    await until(() => changes === 3);
    assert.equal(changes, 3);
    assert.equal(requests.length, 2);
  } finally {
    events.close();
    server.close();
  }
});

test("reads git's diffs into files and lines", () => {
  const text = [
    "diff --git a/a.txt b/a.txt",
    "index 1..2 100644",
    "--- a/a.txt",
    "+++ b/a.txt",
    "@@ -1,3 +1,2 @@ heading",
    " one",
    "--- two",
    "-three",
    "\\ No newline at end of file",
    "+three",
    "diff --git a/old b/new",
    "similarity index 100%",
    "rename from old",
    "rename to new",
    "diff --git \"a/sp ace\" \"b/sp ace\"",
    "new file mode 100644",
    "Binary files /dev/null and \"b/sp ace\" differ",
    "",
  ].join("\n");
  const [a, renamed, binary] = parseDiff(text);
  assert.deepEqual([a.from, a.to, a.status, a.added, a.removed], ["a.txt", "a.txt", "modified", 1, 2]);
  assert.deepEqual(a.hunks[0].lines.map((l) => [l.kind, l.old, l.new, l.text]), [
    ["ctx", 1, 1, "one"],
    ["del", 2, null, "-- two"],
    ["del", 3, null, "three"],
    ["note", null, null, "No newline at end of file"],
    ["add", null, 2, "three"],
  ]);
  assert.deepEqual([renamed.from, renamed.to, renamed.status, renamed.hunks], ["old", "new", "renamed", []]);
  assert.deepEqual([binary.from, binary.to, binary.status, binary.binary], [null, "sp ace", "added", true]);
  assert.equal(unquote(String.raw`"caf\303\251\t\"x\""`), 'caf\u00e9\t"x"');
  assert.equal(unquote("plain"), "plain");
});

test("diffs a worktree from where its branch left the remote's default", async () => {
  const root = mkdtempSync(join(tmpdir(), "herdr-project-web-"));
  const git = (dir: string, ...args: string[]) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "pipe" });
  const origin = join(root, "origin");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  writeFileSync(join(origin, "kept.txt"), "a\nb\n");
  writeFileSync(join(origin, "gone.txt"), "x\n");
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", "Start");

  const project = join(root, "project");
  const wt = join(project, "wt");
  mkdirSync(join(project, "notes"), { recursive: true });
  git(root, "clone", "-q", origin, wt);
  git(wt, "switch", "-q", "-c", "feature");
  git(wt, "rm", "-q", "gone.txt");
  git(wt, "commit", "-q", "-m", "Drop gone.txt");
  writeFileSync(join(wt, "kept.txt"), "a\nB\n");
  writeFileSync(join(wt, "new.txt"), "n\n");
  writeFileSync(join(wt, "empty"), "");
  git(wt, "config", "diff.mnemonicPrefix", "true");
  // The remote moving on doesn't show in the branch's diff.
  writeFileSync(join(origin, "later.txt"), "l\n");
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", "Later");
  git(wt, "fetch", "-q");

  assert.deepEqual(worktreeDirs(project), [wt]);
  assert.deepEqual(checkoutDirs(root), [wt]);
  assert.deepEqual(await summarize(wt), {
    dir: wt, branch: "feature", base: "origin/main", ahead: 1,
    files: 2, added: 1, removed: 2, untracked: 2, error: null,
  });
  const diff = await worktreeDiff(wt);
  assert.deepEqual(diff.commits.map((c) => c.subject), ["Drop gone.txt"]);
  assert.deepEqual(parseDiff(diff.diff).map((f) => [f.from, f.to, f.status, f.added, f.removed]), [
    ["gone.txt", null, "deleted", 0, 1],
    ["kept.txt", "kept.txt", "modified", 1, 1],
    [null, "empty", "added", 0, 0],
    [null, "new.txt", "added", 1, 0],
  ]);
  assert.equal(diff.omitted, 0);

  // Without a remote, it shows what changed since HEAD.
  git(wt, "remote", "remove", "origin");
  assert.equal((await summarize(wt)).base, null);
  assert.equal((await summarize(wt)).files, 1);

  const broken = join(project, "broken");
  mkdirSync(broken);
  writeFileSync(join(broken, ".git"), "gitdir: /nonexistent\n");
  assert.match((await summarize(broken)).error ?? "", /not a git repository/);
});

test("puts removed lines beside the added lines after them", () => {
  const [file] = parseDiff([
    "diff --git a/f b/f", "--- a/f", "+++ b/f",
    "@@ -1,6 +1,5 @@", " a", "-b", "-c", "+B", " d", "-e", "+E", "+F", "\\ No newline at end of file",
    "-g", "\\ No newline at end of file",
    "",
  ].join("\n"));
  const text = (l: { text: string } | null) => l?.text ?? null;
  assert.deepEqual(splitRows(file.hunks[0]).map(([o, n]) => [text(o), text(n)]), [
    ["a", "a"], ["b", "B"], ["c", null], ["d", "d"], ["e", "E"], [null, "F"],
    [null, "No newline at end of file"], ["g", null], ["No newline at end of file", null],
  ]);
});

test("highlights each side of a hunk as a whole", async () => {
  const diff = (path: string) =>
    parseDiff([
      `diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`,
      "@@ -1,2 +1,3 @@", "-/* old", "+/* new", "+   still a comment */", " const x = 1;",
      "",
    ].join("\n"))[0];
  const [del, add, more, ctx] = (await highlight(diff("a.ts"))).hunks[0].lines;
  const colors = (l: typeof del) => l.tokens?.map(([, c]) => c);
  // The second line of the comment is coloured as one too.
  assert.equal(colors(add)?.length, 1);
  assert.deepEqual(colors(more), colors(add));
  assert.deepEqual(colors(del), colors(add));
  assert.equal(ctx.tokens?.map(([t]) => t).join(""), "const x = 1;");
  assert.ok(colors(ctx)?.some((c) => c && c !== colors(add)![0]));
  // Text in the theme's own colour takes the page's.
  assert.deepEqual(ctx.tokens?.find(([t]) => t === " "), [" "]);

  assert.equal((await highlight(diff("notes.unknown"))).hunks[0].lines[0].tokens, undefined);
  assert.deepEqual(["x/Makefile", "a.PY", "README", "b.tsx"].map(language), ["makefile", "py", null, "tsx"]);
});

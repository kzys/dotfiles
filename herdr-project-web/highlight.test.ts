import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiff } from "./diff.ts";
import { highlight, language } from "./highlight.ts";

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

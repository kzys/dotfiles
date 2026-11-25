// The page's view of a worktree's diff.

import { Fragment } from "preact";
import { useRef, useState } from "preact/hooks";
import { type DiffLine, type FileDiff, type Gap, type Hunk, expandHunks, filePath, gapAt, splitRows } from "../diff.ts";
import type { HighlightedDiff } from "./highlight.ts";
import { type Comment, commentKey, displaced } from "../review.ts";
import { CommentAt, type Review, SendReview, type Sender, SentNote, useReview, useSender } from "../review.tsx";
import { projectHref } from "../pages.ts";
import { baseName } from "../paths.ts";
import type { State } from "../state.ts";
import { Refresh, matches, send as post, useFetched } from "../ui.tsx";

// Files with more lines than this start folded.
const FOLD_LINES = 400;

// How many lines of a gap between changes each press shows.
const STEP = 20;

// How the page lays out diffs: one column, or old and new side by side.
type Layout = "unified" | "split";

/** Returns the layout the viewer last chose, kept in this browser. */
function useLayout(): [Layout, (l: Layout) => void] {
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      return localStorage.getItem("diff-layout") === "split" ? "split" : "unified";
    } catch {
      return "unified";
    }
  });
  const choose = (l: Layout) => {
    setLayout(l);
    try {
      localStorage.setItem("diff-layout", l);
    } catch {}
  };
  return [layout, choose];
}

function Stat({ added, removed }: { added: number; removed: number }) {
  return (
    <span class="stat">
      <span class="stat-add">+{added}</span> <span class="stat-del">−{removed}</span>
    </span>
  );
}

const STATUS: Record<FileDiff["status"], string> = {
  added: "new",
  deleted: "deleted",
  modified: "",
  renamed: "renamed",
};

/** Returns line's text, in its tokens' colours where it has them. */
function Code({ line }: { line: DiffLine }) {
  if (!line.tokens) return <>{line.text}</>;
  return (
    <>
      {line.tokens.map(([text, color], i) => (color ? <span key={i} style={{ color }}>{text}</span> : text))}
    </>
  );
}

/** Returns the comment a diff line can take, or null for a line that isn't
 * in a file. Lines removed count by their old number, and all others by
 * their new one, on either side of a split view. */
function anchor(path: string, line: DiffLine): Comment | null {
  const side = line.kind === "del" ? "old" : "new";
  const number = line[side];
  return line.kind === "note" || number === null ? null : { path, side, line: number, code: line.text, body: "" };
}

/** Returns a line's number, which starts a comment on it when clicked. */
function LineNumber({ at, shown, review, kind }: { at: Comment | null; shown: number | null; review: Review; kind?: string }) {
  const cls = `ln${kind ? ` line-${kind}` : ""}${at ? " ln-comment" : ""}`;
  return (
    <td class={cls} title={at ? "Comment on this line" : undefined} onClick={at ? () => review.edit(at) : undefined}>
      {shown}
    </td>
  );
}

/** Returns the rows under a line with its comment or the box writing one. */
function CommentRows({ ats, review, sender, span }: { ats: (Comment | null)[]; review: Review; sender: Sender; span: number }) {
  const keys = new Set<string>();
  return (
    <>
      {ats.flatMap((at) => {
        if (!at || keys.has(commentKey(at))) return [];
        const key = commentKey(at);
        keys.add(key);
        const editing = review.editing && commentKey(review.editing) === key;
        if (!editing && !review.comments.some((c) => commentKey(c) === key)) return [];
        return [
          <tr key={key} class="comment-row">
            <td colSpan={span}>
              <CommentAt at={at} review={review} sender={sender} />
            </td>
          </tr>,
        ];
      })}
    </>
  );
}

/** Returns the cells of one side of a split row: line's number in the
 * file of that side, and its text. */
function Side({ line, side, path, review }: { line: DiffLine | null; side: "old" | "new"; path: string; review: Review }) {
  if (!line) return <td class="blank" colSpan={2} />;
  return (
    <>
      <LineNumber at={anchor(path, line)} shown={line[side]} review={review} kind={line.kind} />
      <td class={`code line-${line.kind}`}>
        <Code line={line} />
      </td>
    </>
  );
}

// Which way a press shows lines of a gap: from its start, below the hunk
// above, or from its end, above the hunk below.
type End = "start" | "end";

/** Returns the buttons that show more of gap, where before and after say
 * whether hunks lie on those sides of it. */
function Expanders({ gap, before, after, expand }: { gap: Gap; before: boolean; after: boolean; expand: (end: End) => void }) {
  const size = gap.to === null ? null : gap.to - gap.from + 1;
  if (size !== null && size <= STEP) {
    return (
      <button class="expand" onClick={() => expand(before ? "start" : "end")}>
        show {size} more line{size === 1 ? "" : "s"}
      </button>
    );
  }
  return (
    <>
      {after && (
        <button class="expand" title="Show more lines above this" onClick={() => expand("end")}>
          ↑ {STEP} lines
        </button>
      )}
      {before && (
        <button class="expand" title="Show more lines below this" onClick={() => expand("start")}>
          ↓ {STEP} lines
        </button>
      )}
    </>
  );
}

/** Returns file's diff, folded or not, as a table of its lines, in one
 * column or side by side as layout says. expand shows more of the gap
 * before its hunk i, or after the last, and ended says that the file has
 * nothing after it. */
function FileView({ file, id, layout, review, sender, expand, ended }: {
  file: FileDiff; id: string; layout: Layout; review: Review; sender: Sender; expand: (i: number, end: End) => void; ended: boolean;
}) {
  const lines = file.hunks.reduce((n, h) => n + h.lines.length, 0);
  const [open, setOpen] = useState(lines <= FOLD_LINES);
  const path = filePath(file);
  const span = layout === "split" ? 4 : 3;
  const canExpand = file.status === "modified" || file.status === "renamed";
  const gap = (i: number) => (canExpand ? gapAt(file.hunks, i) : null);
  const tail = ended ? null : gap(file.hunks.length);
  return (
    <section class="card file" id={id}>
      <header class="file-head" onClick={() => setOpen(!open)}>
        <span class={open ? "fold open" : "fold"} aria-hidden="true" />
        <span class="file-path">
          {file.status === "renamed" && file.from !== file.to && <span class="file-from">{file.from} → </span>}
          {path}
        </span>
        {STATUS[file.status] && <span class={`badge file-${file.status}`}>{STATUS[file.status]}</span>}
        <Stat added={file.added} removed={file.removed} />
      </header>
      {open &&
        (file.binary ? (
          <p class="empty file-note">Binary file.</p>
        ) : !file.hunks.length ? (
          <p class="empty file-note">
            {file.status === "renamed"
              ? "Renamed without changes."
              : file.status === "modified"
                ? "Only its mode changed."
                : "Empty file."}
          </p>
        ) : (
          <div class="diff-scroll">
            <table class={`diff diff-${layout}`}>
              {layout === "split" && (
                <colgroup>
                  <col class="ln-col" />
                  <col />
                  <col class="ln-col" />
                  <col />
                </colgroup>
              )}
              {file.hunks.map((h, i) => (
                <tbody key={i}>
                  <tr class="hunk">
                    <td colSpan={span}>
                      {gap(i) && <Expanders gap={gap(i)!} before={i > 0} after expand={(end) => expand(i, end)} />}
                      {h.header}
                    </td>
                  </tr>
                  {layout === "split"
                    ? splitRows(h).map(([old, now], j) => (
                        <Fragment key={j}>
                          <tr>
                            <Side line={old} side="old" path={path} review={review} />
                            <Side line={now} side="new" path={path} review={review} />
                          </tr>
                          <CommentRows
                            ats={[old && anchor(path, old), now && anchor(path, now)]}
                            review={review}
                            sender={sender}
                            span={4}
                          />
                        </Fragment>
                      ))
                    : h.lines.map((l, j) => (
                        <Fragment key={j}>
                          <tr class={`line line-${l.kind}`}>
                            <LineNumber at={l.kind === "del" ? anchor(path, l) : null} shown={l.old} review={review} />
                            <LineNumber at={l.kind === "del" ? null : anchor(path, l)} shown={l.new} review={review} />
                            <td class="code">
                              <Code line={l} />
                            </td>
                          </tr>
                          <CommentRows ats={[anchor(path, l)]} review={review} sender={sender} span={3} />
                        </Fragment>
                      ))}
                </tbody>
              ))}
              {tail && (
                <tbody>
                  <tr class="hunk">
                    <td colSpan={span}>
                      <Expanders gap={tail} before after={false} expand={(end) => expand(file.hunks.length, end)} />
                    </td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>
        ))}
    </section>
  );
}

// How the page says what chose a diff's base.
const SOURCES: Record<string, string> = { "pull request": "its pull request", setting: "chosen", "created from": "where it was created" };

/** Returns the choice of what a branch starts from. A pull request's base
 * is GitHub's to change. */
function BasePicker({ wt, refresh }: { wt: HighlightedDiff; refresh: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (!wt.branch || wt.source === "pull request" || !wt.baseOptions.length) return null;
  const choose = async (base: string) => {
    try {
      await post("POST", "/diff/base", { dir: wt.dir, branch: wt.branch, base: base || null });
      setError(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <select aria-label="Base" value="" onChange={(e) => choose(e.currentTarget.value)}>
        <option value="" disabled hidden>
          change base
        </option>
        {wt.chosenBase && <option value="">automatic</option>}
        {wt.baseOptions.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      {error && <span class="agent-error">{error}</span>}
    </>
  );
}

// The hunks of a file with lines added from its gaps, for the changes they
// were added to, and whether its end has been reached.
type Expanded = { changes: string; hunks: Hunk[]; ended: boolean };

const fileKey = (f: FileDiff) => `${f.from}:${f.to}`;
const changesOf = (f: FileDiff) => JSON.stringify(f.hunks.map((h) => [h.header, h.lines.map((l) => l.text)]));

/** Returns the diff of the worktree in dir, from where its branch
 * started, with its files matching query, under project, the project it
 * was opened from, or else the one that lists it in state. */
export function WorktreeDiffView({ dir, project, query, state }: { dir: string; project: string | null; query: string; state: State | null }) {
  const owner = project ?? state?.projects.find((p) => p.worktrees.some((w) => w.dir === dir))?.dir ?? null;
  const ownerName = state?.projects.find((p) => p.dir === owner)?.name ?? (owner && baseName(owner));
  const [layout, setLayout] = useLayout();
  const review = useReview(dir);
  const [fetched, error, at, refresh] = useFetched<HighlightedDiff>(`/diff?dir=${encodeURIComponent(dir)}`);
  const [more, setMore] = useState<Record<string, Expanded>>({});
  const [lineError, setLineError] = useState<string | null>(null);
  const expanding = useRef(new Set<string>());
  // Lines shown stay until the file's changes do, as when git is asked again.
  const expandedOf = (f: FileDiff) => {
    const e = more[fileKey(f)];
    return e?.changes === changesOf(f) ? e : null;
  };
  const files = (fetched?.fileDiffs ?? []).map((f) => ({ ...f, hunks: expandedOf(f)?.hunks ?? f.hunks }));
  const wt = fetched && { ...fetched, fileDiffs: files };
  const sender = useSender(review, wt, state);
  const expand = async (original: FileDiff, i: number, end: End) => {
    const hunks = expandedOf(original)?.hunks ?? original.hunks;
    const gap = gapAt(hunks, i);
    if (!gap) return;
    const from = end === "start" || gap.to === null ? gap.from : Math.max(gap.from, gap.to - STEP + 1);
    const to = end === "end" ? gap.to! : Math.min(gap.to ?? Infinity, gap.from + STEP - 1);
    const query = new URLSearchParams({
      dir, path: filePath(original), from: String(from), to: String(to), at: String(fetched!.at),
    });
    // Another expansion would start from these hunks too, and undo this one.
    if (expanding.current.has(fileKey(original))) return;
    expanding.current.add(fileKey(original));
    try {
      const res = await fetch(`/diff/lines?${query}`);
      const stale = () => {
        refresh();
        return new Error("the file changed, so its diff was read again");
      };
      if (res.status === 409) throw stale();
      if (!res.ok) throw new Error((await res.json()).error);
      const texts: Pick<DiffLine, "text" | "tokens">[] = await res.json();
      // A gap between hunks is all there; only the last can run out.
      if (gap.to !== null && texts.length !== to - from + 1) throw stale();
      const lines = texts.map((t, n): DiffLine => ({ ...t, kind: "ctx", old: from + n + gap.offset, new: from + n }));
      setMore((all) => ({
        ...all,
        [fileKey(original)]: {
          changes: changesOf(original),
          hunks: lines.length ? expandHunks(hunks, i, lines, end) : hunks,
          // The last gap has no known end but the file's.
          ended: !!expandedOf(original)?.ended || (gap.to === null && lines.length < to - from + 1),
        },
      }));
      setLineError(null);
    } catch (e) {
      setLineError((e as Error).message);
    } finally {
      expanding.current.delete(fileKey(original));
    }
  };
  const shown = files.filter((f) => matches(query, f.from, f.to));
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const fileId = (i: number) => `file-${i}`;
  return (
    <div class="diffs">
      <h2>
        <a href="/projects">Projects</a> / {owner && <><a href={projectHref(owner)}>{ownerName}</a> / </>}{baseName(dir)}
        <span class="layout" role="group" aria-label="Layout">
          {(["unified", "split"] as const).map((l) => (
            <button key={l} class={l === layout ? "here" : ""} aria-pressed={l === layout} onClick={() => setLayout(l)}>
              {l}
            </button>
          ))}
        </span>
        <Refresh at={at} onClick={refresh} />
      </h2>
      {error && <p class="empty">Couldn't read the diff: {error}</p>}
      {lineError && <p class="empty">Couldn't read more lines: {lineError}</p>}
      {sender.sent && <SentNote key={sender.sent.at} sent={sender.sent} dismiss={sender.dismiss} state={state} />}
      {!wt ? (
        !error && <p class="empty">Asking git…</p>
      ) : (
        <>
          <section class="card">
            <header>
              <span class="name">{wt.branch ?? "detached"}</span>
              <span class="title">
                {wt.base ? `since it left ${wt.base}` : "since HEAD"}
                {wt.source && wt.source !== "default" && ` (${SOURCES[wt.source]})`} · {dir}
              </span>
              <Stat added={added} removed={removed} />
              <BasePicker wt={wt} refresh={refresh} />
            </header>
            {wt.error && <p class="empty file-note wt-error">{wt.error}</p>}
            {wt.commits.length > 0 && (
              <ul class="commits">
                {wt.commits.map((c) => (
                  <li key={c.hash}>
                    <code>{c.hash}</code> {c.subject}
                  </li>
                ))}
              </ul>
            )}
            {files.length > 0 && (
              <ul class="file-index">
                {files.map((f, i) => (
                  <li key={i}>
                    <button
                      onClick={() => document.getElementById(fileId(i))?.scrollIntoView({ behavior: "smooth" })}
                    >
                      {filePath(f)}
                    </button>
                    <Stat added={f.added} removed={f.removed} />
                  </li>
                ))}
              </ul>
            )}
            {wt.omitted > 0 && (
              <p class="empty file-note">
                {wt.omitted} untracked {wt.omitted === 1 ? "file or repository isn't" : "files or repositories aren't"} shown.
              </p>
            )}
            {!files.length && !wt.error && <p class="empty file-note">No changes.</p>}
            <SendReview review={review} sender={sender} moved={displaced(review.comments, files)} />
          </section>
          {shown.map((f) => {
            const original = fetched!.fileDiffs[files.indexOf(f)];
            return (
              <FileView
                key={fileKey(f)}
                file={f}
                id={fileId(files.indexOf(f))}
                layout={layout}
                review={review}
                sender={sender}
                expand={(i, end) => expand(original, i, end)}
                ended={!!expandedOf(original)?.ended}
              />
            );
          })}
          {files.length > 0 && !shown.length && <p class="empty">No match.</p>}
        </>
      )}
    </div>
  );
}

// The page's view of the worktrees in the projects and their diffs.

import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { type DiffLine, type FileDiff, filePath, splitRows } from "./diff.ts";
import type { HighlightedDiff } from "./highlight.ts";
import { type Comment, commentKey, displaced, reviewMessage, reviewers, withComment } from "./review.ts";
import type { State } from "./state.ts";
import { Refresh, matches, send, useFetched } from "./ui.tsx";
import type { Summary } from "./worktrees.ts";

// Files with more lines than this start folded.
const FOLD_LINES = 400;

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

type ProjectWorktrees = { dir: string; name: string; title: string; worktrees: Summary[] };

/** Returns the link to the diff of the worktree in dir. */
export const diffHref = (dir: string) => `#diffs/${encodeURIComponent(dir)}`;

const base = (dir: string) => dir.split("/").pop() ?? dir;

function Stat({ added, removed }: { added: number; removed: number }) {
  return (
    <span class="stat">
      <span class="stat-add">+{added}</span> <span class="stat-del">−{removed}</span>
    </span>
  );
}

function WorktreeRow({ wt }: { wt: Summary }) {
  const clean = !wt.files && !wt.untracked && !wt.ahead;
  return (
    <li class={clean ? "wt clean" : "wt"}>
      <a class="wt-name" href={diffHref(wt.dir)}>
        {base(wt.dir)}
      </a>
      {wt.error ? (
        <span class="wt-error">{wt.error}</span>
      ) : (
        <>
          <span class="wt-branch">
            {wt.branch ?? "detached"}
            {wt.base && <span class="wt-base"> ← {wt.base}</span>}
          </span>
          <span class="wt-counts">
            {wt.ahead > 0 && <span>{wt.ahead} commit{wt.ahead === 1 ? "" : "s"}</span>}
            {wt.files > 0 && <span>{wt.files} file{wt.files === 1 ? "" : "s"}</span>}
            {wt.untracked > 0 && <span>{wt.untracked} untracked</span>}
            {clean && <span>no changes</span>}
          </span>
          {wt.files > 0 && <Stat added={wt.added} removed={wt.removed} />}
        </>
      )}
    </li>
  );
}

/** Returns the open projects' worktrees, matching query, with how each
 * differs from where its branch started. */
export function WorktreeList({ query }: { query: string }) {
  const [projects, error, at, refresh] = useFetched<ProjectWorktrees[]>("/api/worktrees");
  const shown = (projects ?? [])
    .map((p) =>
      matches(query, p.name, p.title)
        ? p
        : { ...p, worktrees: p.worktrees.filter((w) => matches(query, `${base(w.dir)} ${w.branch ?? ""}`)) },
    )
    .filter((p) => p.worktrees.length);
  return (
    <div class="diffs">
      <h2>
        Worktrees <Refresh at={at} onClick={refresh} />
      </h2>
      {error && <p class="empty">Couldn't list worktrees: {error}</p>}
      {!projects ? (
        !error && <p class="empty">Asking git…</p>
      ) : !shown.length ? (
        <p class="empty">{query ? "No match." : "No worktrees in open projects."}</p>
      ) : (
        shown.map((p) => (
          <section key={p.dir} class="card">
            <header>
              <span class="name">{p.name}</span>
              <span class="title">{p.title}</span>
            </header>
            <ul class="wts">
              {p.worktrees.map((w) => (
                <WorktreeRow key={w.dir} wt={w} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
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

/** The comments on a diff, kept in this browser until they are sent, even
 * as they are written, and the one being written. */
type Review = {
  comments: Comment[];
  editing: Comment | null;
  edit: (at: Comment) => void;
  write: (body: string) => void;
  save: () => void;
  // Stops writing, putting back what the comment said before.
  cancel: () => void;
  remove: (gone: Comment[]) => void;
};

/** Returns the review of the diff of dir. */
function useReview(dir: string): Review {
  const key = `review:${dir}`;
  const [comments, setComments] = useState<Comment[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "[]");
    } catch {
      return [];
    }
  });
  const [editing, setEditing] = useState<Comment | null>(null);
  const before = useRef("");
  const update = (change: (all: Comment[]) => Comment[]) => {
    setComments((all) => {
      const next = change(all);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  return {
    comments,
    editing,
    edit: (at) => {
      const body = comments.find((c) => commentKey(c) === commentKey(at))?.body ?? "";
      before.current = body;
      setEditing({ ...at, body });
    },
    write: (body) => {
      if (!editing) return;
      setEditing({ ...editing, body });
      update((all) => withComment(all, { ...editing, body }));
    },
    save: () => setEditing(null),
    cancel: () => {
      if (editing) update((all) => withComment(all, { ...editing, body: before.current }));
      setEditing(null);
    },
    remove: (gone) => update((all) => all.filter((c) => !gone.some((g) => commentKey(g) === commentKey(c)))),
  };
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

/** Returns the box that writes the comment being edited. */
function CommentBox({ review }: { review: Review }) {
  const { path, line, body } = review.editing!;
  const box = useRef<HTMLTextAreaElement>(null);
  // Not autofocus, which browsers honour once per page.
  useEffect(() => box.current?.focus(), [path, line]);
  return (
    <div class="comment">
      <textarea
        ref={box}
        rows={3}
        value={body}
        aria-label={`Comment on ${path} line ${line}`}
        onInput={(e) => review.write(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) review.save();
          if (e.key === "Escape") review.cancel();
        }}
      />
      <div class="comment-actions">
        <button class="copy" onClick={review.save}>
          save
        </button>
        <button class="copy" onClick={review.cancel}>
          cancel
        </button>
      </div>
    </div>
  );
}

/** Returns the rows under a line with its comment or the box writing one. */
function CommentRows({ ats, review, span }: { ats: (Comment | null)[]; review: Review; span: number }) {
  const keys = new Set<string>();
  return (
    <>
      {ats.flatMap((at) => {
        if (!at || keys.has(commentKey(at))) return [];
        const key = commentKey(at);
        keys.add(key);
        const editing = review.editing && commentKey(review.editing) === key;
        const saved = review.comments.find((c) => commentKey(c) === key);
        if (!editing && !saved) return [];
        return [
          <tr key={key} class="comment-row">
            <td colSpan={span}>
              {editing ? (
                <CommentBox review={review} />
              ) : (
                <div class="comment">
                  <p class="comment-body">{saved!.body}</p>
                  <div class="comment-actions">
                    <button class="copy" onClick={() => review.edit(at)}>
                      edit
                    </button>
                    <button class="copy" onClick={() => review.remove([saved!])}>
                      delete
                    </button>
                  </div>
                </div>
              )}
            </td>
          </tr>,
        ];
      })}
    </>
  );
}

/** Returns what sends the review to one of the agents working in the diff,
 * where it waits until that agent is free, and lists comments whose lines
 * changed, to send as they are or drop. */
function SendReview({ review, wt, state }: { review: Review; wt: HighlightedDiff; state: State | null }) {
  const agents = state?.controls ? reviewers(state.projects, wt.dir) : [];
  const [picked, pick] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const pane = agents.some(([id]) => id === picked) ? picked : (agents[0]?.[0] ?? null);
  const count = review.comments.length;
  const moved = displaced(review.comments, wt.fileDiffs);
  if (!count) return status ? <p class="review-bar">{status}</p> : null;
  const submit = async () => {
    const sent = review.comments;
    setSending(true);
    try {
      await send("POST", `/api/agents/${encodeURIComponent(pane!)}/messages`, { text: reviewMessage(wt.dir, wt.branch, sent) });
      review.remove(sent);
      setStatus(`Sent to ${agents.find(([id]) => id === pane)?.[1]}. It gets them when it is free.`);
    } catch (e) {
      setStatus(`Couldn't send them: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };
  return (
    <div class="review-bar">
      <span>
        {count} comment{count === 1 ? "" : "s"}
      </span>
      {agents.length > 1 && (
        <select value={pane ?? ""} aria-label="Agent" onChange={(e) => pick(e.currentTarget.value)}>
          {agents.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      )}
      <button class="copy" disabled={!pane || sending} onClick={submit}>
        {pane ? `send to ${agents.find(([id]) => id === pane)?.[1]}` : "no agent to send to"}
      </button>
      {status && <span class="agent-error">{status}</span>}
      {moved.map((c) => (
        <div key={commentKey(c)} class="comment-moved">
          <span>
            {c.path}:{c.line} changed: {c.body}
          </span>
          <button class="copy" onClick={() => review.remove([c])}>
            delete
          </button>
        </div>
      ))}
    </div>
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

/** Returns file's diff, folded or not, as a table of its lines, in one
 * column or side by side as layout says. */
function FileView({ file, id, layout, review }: { file: FileDiff; id: string; layout: Layout; review: Review }) {
  const lines = file.hunks.reduce((n, h) => n + h.lines.length, 0);
  const [open, setOpen] = useState(lines <= FOLD_LINES);
  const path = filePath(file);
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
                    <td colSpan={layout === "split" ? 4 : 3}>{h.header}</td>
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
                          <CommentRows ats={[anchor(path, l)]} review={review} span={3} />
                        </Fragment>
                      ))}
                </tbody>
              ))}
            </table>
          </div>
        ))}
    </section>
  );
}

/** Returns the diff of the worktree in dir, from where its branch
 * started, with its files matching query. */
export function WorktreeDiffView({ dir, query, state }: { dir: string; query: string; state: State | null }) {
  const [layout, setLayout] = useLayout();
  const review = useReview(dir);
  const [wt, error, at, refresh] = useFetched<HighlightedDiff>(`/api/diff?dir=${encodeURIComponent(dir)}`);
  const files = wt?.fileDiffs ?? [];
  const shown = files.filter((f) => matches(query, f.from, f.to));
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const fileId = (i: number) => `file-${i}`;
  return (
    <div class="diffs">
      <h2>
        <a href="#diffs">Worktrees</a> / {base(dir)}
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
      {!wt ? (
        !error && <p class="empty">Asking git…</p>
      ) : (
        <>
          <section class="card">
            <header>
              <span class="name">{wt.branch ?? "detached"}</span>
              <span class="title">
                {wt.base ? `since it left ${wt.base}` : "since HEAD"} · {dir}
              </span>
              <Stat added={added} removed={removed} />
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
            <SendReview review={review} wt={wt} state={state} />
          </section>
          {shown.map((f) => (
            <FileView key={`${f.from}:${f.to}`} file={f} id={fileId(files.indexOf(f))} layout={layout} review={review} />
          ))}
          {files.length > 0 && !shown.length && <p class="empty">No match.</p>}
        </>
      )}
    </div>
  );
}

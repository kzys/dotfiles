// The page's view of the worktrees in the projects and their diffs.

import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { type DiffLine, type FileDiff, type Gap, type Hunk, edgeLine, expandHunks, filePath, gapAt, splitRows } from "./diff.ts";
import type { HighlightedDiff } from "./highlight.ts";
import { type Comment, type Reviewer, clearReviewer, commentKey, displaced, reviewMessage, reviewers, withComment } from "./review.ts";
import type { State } from "./state.ts";
import { Refresh, matches, send as post, useFetched } from "./ui.tsx";
import type { Summary } from "./worktrees.ts";

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
    // Not one written further since, as while it was being sent.
    remove: (gone) => update((all) => all.filter((c) => !gone.some((g) => commentKey(g) === commentKey(c) && g.body === c.body))),
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

/** Returns the box that writes the comment being edited, which can go to
 * the agent straight away, without the others. */
function CommentBox({ review, sender }: { review: Review; sender: Sender }) {
  const { path, line, body } = review.editing!;
  const [error, setError] = useState<string | null>(null);
  const sendNow = async () => {
    const failed = await sender.send([review.editing!]);
    setError(failed);
    if (!failed) review.save();
  };
  const box = useRef<HTMLTextAreaElement>(null);
  // Not autofocus, which browsers honour once per page.
  useEffect(() => box.current?.focus(), [path, line]);
  return (
    <div class="comment">
      <textarea
        ref={box}
        rows={3}
        value={body}
        readOnly={sender.sending}
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
        <AgentPicker sender={sender} />
        <button
          class="copy"
          disabled={!sender.target || sender.sending || !body.trim()}
          title="Send only this comment"
          onClick={sendNow}
        >
          {sender.target ? `send to ${sender.target.label}` : "choose an agent to send to"}
        </button>
        {error && <span class="agent-error">Couldn't send it: {error}</span>}
      </div>
    </div>
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
        const saved = review.comments.find((c) => commentKey(c) === key);
        if (!editing && !saved) return [];
        return [
          <tr key={key} class="comment-row">
            <td colSpan={span}>
              {editing ? (
                <CommentBox review={review} sender={sender} />
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

/** Sends comments to the agent chosen, where they wait until it is free. */
type Sender = {
  agents: Reviewer[];
  target: Reviewer | null;
  pick: (id: string) => void;
  sending: boolean;
  status: string | null;
  // Returns why it couldn't send them, or null once it has.
  send: (comments: Comment[]) => Promise<string | null>;
};

/** Returns what sends comments on wt, once it is read, to the agents working
 * in it, removing them from review once sent. */
function useSender(review: Review, wt: HighlightedDiff | null, state: State | null): Sender {
  const agents = state?.controls && wt ? reviewers(state.projects, wt.dir) : [];
  const [picked, pick] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // One picked that has gone stays gone, rather than becoming another.
  const target = picked ? (agents.find((a) => a.id === picked) ?? null) : clearReviewer(agents);
  const send = async (comments: Comment[]) => {
    if (!target || !wt) return "no agent chosen";
    setSending(true);
    try {
      await post("POST", `/api/agents/${encodeURIComponent(target.id)}/messages`, { text: reviewMessage(wt.dir, wt.branch, comments) });
      review.remove(comments);
      setStatus(`Sent to ${target.label}. It gets ${comments.length === 1 ? "it" : "them"} when it is free.`);
      setTimeout(() => setStatus(null), 5000);
      return null;
    } catch (e) {
      return (e as Error).message;
    } finally {
      setSending(false);
    }
  };
  return { agents, target, pick, sending, status, send };
}

/** Returns the choice of agent, where there is one to make. */
function AgentPicker({ sender }: { sender: Sender }) {
  if (sender.agents.length < 2) return null;
  return (
    <select value={sender.target?.id ?? ""} aria-label="Agent" onChange={(e) => sender.pick(e.currentTarget.value)}>
      {!sender.target && <option value="">choose an agent</option>}
      {sender.agents.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </select>
  );
}

/** Returns what sends every comment, and lists those whose lines changed,
 * to send as they are or drop. */
function SendReview({ review, sender, files }: { review: Review; sender: Sender; files: FileDiff[] }) {
  const [error, setError] = useState<string | null>(null);
  const { target, agents } = sender;
  const count = review.comments.length;
  const moved = displaced(review.comments, files);
  if (!count) return null;
  return (
    <div class="review-bar">
      <span>
        {count} comment{count === 1 ? "" : "s"}
      </span>
      <AgentPicker sender={sender} />
      <button class="copy" disabled={!target || sender.sending} onClick={async () => setError(await sender.send(review.comments))}>
        {target ? `send to ${target.label}` : agents.length ? "choose an agent to send to" : "no agent to send to"}
      </button>
      {error && <span class="agent-error">Couldn't send them: {error}</span>}
      {moved.map((c) => (
        <div key={commentKey(c)} class="comment-moved">
          <span>
            {c.path}:{c.line} isn't in the diff as shown: {c.body}
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

// The hunks of a file with lines added from its gaps, for the changes they
// were added to, and whether its end has been reached.
type Expanded = { changes: string; hunks: Hunk[]; ended: boolean };

const fileKey = (f: FileDiff) => `${f.from}:${f.to}`;
const changesOf = (f: FileDiff) => JSON.stringify(f.hunks.map((h) => [h.header, h.lines.map((l) => l.text)]));

/** Returns the diff of the worktree in dir, from where its branch
 * started, with its files matching query. */
export function WorktreeDiffView({ dir, query, state }: { dir: string; query: string; state: State | null }) {
  const [layout, setLayout] = useLayout();
  const review = useReview(dir);
  const [fetched, error, at, refresh] = useFetched<HighlightedDiff>(`/api/diff?dir=${encodeURIComponent(dir)}`);
  const [more, setMore] = useState<Record<string, Expanded>>({});
  const [lineError, setLineError] = useState<string | null>(null);
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
    // One line more on the side that meets a hunk, which shows whether the
    // file still matches this diff.
    const above = end === "start" && i > 0 ? edgeLine(hunks[i - 1], "last") : null;
    const below = end === "end" ? edgeLine(hunks[i], "first") : null;
    const range = { from: from - (above === null ? 0 : 1), to: to + (below === null ? 0 : 1) };
    const query = new URLSearchParams({ dir, path: filePath(original), from: String(range.from), to: String(range.to) });
    try {
      const res = await fetch(`/api/lines?${query}`);
      if (!res.ok) throw new Error((await res.json()).error);
      const read: Pick<DiffLine, "text" | "tokens">[] = await res.json();
      if ((above !== null && read[0]?.text !== above) || (below !== null && read.at(-1)?.text !== below)) {
        refresh();
        throw new Error("the file changed, so its diff was read again");
      }
      const texts = read.slice(above === null ? 0 : 1, below === null ? undefined : -1);
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
    }
  };
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
      {lineError && <p class="empty">Couldn't read more lines: {lineError}</p>}
      {sender.status && <p class="sent-note">{sender.status}</p>}
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
            <SendReview review={review} sender={sender} files={files} />
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

// The page's view of the worktrees in the projects and their diffs.

import { useEffect, useRef, useState } from "preact/hooks";
import { type DiffLine, type FileDiff, filePath, splitRows } from "./diff.ts";
import type { HighlightedDiff } from "./highlight.ts";
import type { Worktree } from "./state.ts";
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

/** Returns links to the diffs of worktrees, by name, each with the
 * subject of its last commit. */
export function WorktreeLinks({ worktrees }: { worktrees: Worktree[] }) {
  if (!worktrees.length) return null;
  return (
    <nav class="wt-links" aria-label="Diffs">
      {worktrees.map((w) => (
        <a key={w.dir} href={diffHref(w.dir)}>
          <span class="wt-link-name">{base(w.dir)}</span>
          <span class="wt-subject">{w.subject}</span>
        </a>
      ))}
    </nav>
  );
}

/** Returns what url says, as JSON, fetched again by refresh and
 * whenever the window regains focus, and when it was fetched. */
function useFetched<T>(url: string): [T | null, string | null, Date | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const latest = useRef(0);
  const refresh = async () => {
    const n = ++latest.current;
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (n !== latest.current) return;
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setData(body);
      setError(null);
      setAt(new Date());
    } catch (e) {
      if (n === latest.current) setError((e as Error).message);
    }
  };
  useEffect(() => {
    setData(null);
    refresh();
    addEventListener("focus", refresh);
    return () => removeEventListener("focus", refresh);
  }, [url]);
  return [data, error, at, refresh];
}

/** Returns a button that fetches again, saying when it last did. */
function Refresh({ at, onClick }: { at: Date | null; onClick: () => void }) {
  return (
    <button class="copy" onClick={onClick} title="Ask git again">
      {at ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "…"} ↻
    </button>
  );
}

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
      [p.name, p.title].some((t) => t.toLowerCase().includes(query))
        ? p
        : { ...p, worktrees: p.worktrees.filter((w) => `${base(w.dir)} ${w.branch ?? ""}`.toLowerCase().includes(query)) },
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

/** Returns the cells of one side of a split row: line's number in the
 * file of that side, and its text. */
function Side({ line, side }: { line: DiffLine | null; side: "old" | "new" }) {
  if (!line) return <td class="blank" colSpan={2} />;
  return (
    <>
      <td class={`ln line-${line.kind}`}>{line[side]}</td>
      <td class={`code line-${line.kind}`}>
        <Code line={line} />
      </td>
    </>
  );
}

/** Returns file's diff, folded or not, as a table of its lines, in one
 * column or side by side as layout says. */
function FileView({ file, id, layout }: { file: FileDiff; id: string; layout: Layout }) {
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
                        <tr key={j}>
                          <Side line={old} side="old" />
                          <Side line={now} side="new" />
                        </tr>
                      ))
                    : h.lines.map((l, j) => (
                        <tr key={j} class={`line line-${l.kind}`}>
                          <td class="ln">{l.old}</td>
                          <td class="ln">{l.new}</td>
                          <td class="code">
                            <Code line={l} />
                          </td>
                        </tr>
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
export function WorktreeDiffView({ dir, query }: { dir: string; query: string }) {
  const [layout, setLayout] = useLayout();
  const [wt, error, at, refresh] = useFetched<HighlightedDiff>(`/api/diff?dir=${encodeURIComponent(dir)}`);
  const files = wt?.fileDiffs ?? [];
  const shown = files.filter((f) => [f.from, f.to].some((p) => p?.toLowerCase().includes(query)));
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
          </section>
          {shown.map((f) => (
            <FileView key={`${f.from}:${f.to}`} file={f} id={fileId(files.indexOf(f))} layout={layout} />
          ))}
          {files.length > 0 && !shown.length && <p class="empty">No match.</p>}
        </>
      )}
    </div>
  );
}

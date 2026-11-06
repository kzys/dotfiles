// The page of a file of a project: Markdown rendered, its blocks taking
// comments for agents as a diff's lines do, anything else as plain text.

import { h } from "preact";
import { useEffect, useMemo, useRef } from "preact/hooks";
import { CommentAt, type Review, SendReview, type Sender, SentNote, useReview, useSender } from "./diffs.tsx";
import { type MarkdownNode, commentable, markdownTree } from "./markdown.ts";
import { projectHref } from "./pages.ts";
import { type Comment, commentKey, displacedFromBlocks } from "./review.ts";
import type { State } from "./state.ts";
import { Refresh, useFetched } from "./ui.tsx";

type FileText = { text?: string; error?: string };

/** Returns the file called name in the project in dir as useFetched
 * does, fetched again whenever at, when it last changed, does. */
function useFile(dir: string, name: string, at: number | null) {
  const fetched = useFetched<FileText>(
    `/api/file?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`,
  );
  const [, , , refresh] = fetched;
  // useFetched fetches it first; fetch again only on changes.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else refresh();
  }, [at]);
  return fetched;
}

/** Returns node and what it holds, each block that can take a comment with
 * its first line's number, which starts one when clicked, and its comment. */
function MarkdownBlock({ node, path, review, sender }: { node: MarkdownNode; path: string; review: Review; sender: Sender }) {
  const element = h(
    node.tag,
    { ...node.attrs, ...(node.html === null ? {} : { dangerouslySetInnerHTML: { __html: node.html } }) },
    node.html === null && node.nodes.length
      ? node.nodes.map((n, i) => <MarkdownBlock key={i} node={n} path={path} review={review} sender={sender} />)
      : null,
  );
  if (!node.at) return element;
  const at: Comment = { path, side: "new", ...node.at, body: "" };
  const key = commentKey(at);
  const commented = review.comments.some((c) => commentKey(c) === key) || (review.editing && commentKey(review.editing) === key);
  return (
    <div class={commented ? "md-block commented" : "md-block"}>
      <button class="md-line" title="Comment on this" onClick={() => review.edit(at)}>
        {node.at.line}
      </button>
      {element}
      <CommentAt at={at} review={review} sender={sender} />
    </div>
  );
}

/** Returns the Markdown text of the file called name in the project in
 * dir, with what comments on it and sends the comments to its agents. */
function ReviewedMarkdown({ dir, name, text, state }: { dir: string; name: string; text: string; state: State | null }) {
  const review = useReview(`${dir}/${name}`);
  const sender = useSender(review, { dir, branch: null }, state);
  // A comment being written stays on the block it was opened on, even as an
  // agent edits the file; the new text shows once it is saved.
  const shown = useRef(text);
  if (!review.editing) shown.current = text;
  const nodes = useMemo(() => markdownTree(shown.current), [shown.current]);
  return (
    <>
      {sender.sent && <SentNote key={sender.sent.at} sent={sender.sent} dismiss={sender.dismiss} state={state} />}
      <div class="markdown reviewed">
        {nodes.map((n, i) => (
          <MarkdownBlock key={i} node={n} path={name} review={review} sender={sender} />
        ))}
      </div>
      <SendReview review={review} sender={sender} moved={displacedFromBlocks(review.comments, name, commentable(nodes))} />
    </>
  );
}

/** Returns what file, called name in the project in dir, says, or why it
 * can't be shown. */
function FileBody({ dir, name, file, error, state }: { dir: string; name: string; file: FileText | null; error: string | null; state: State | null }) {
  if (!file) return <p class="empty">{error ? `Couldn't read it: ${error}` : "Reading…"}</p>;
  if (file.text === undefined) return <p class="empty">{file.error}</p>;
  // What was read stays when reading it again fails, with any comment on it.
  return (
    <article class="card file-page">
      {error && <p class="empty">Couldn't read it again: {error}</p>}
      {name.toLowerCase().endsWith(".md") ? (
        <ReviewedMarkdown key={`${dir}/${name}`} dir={dir} name={name} text={file.text} state={state} />
      ) : (
        <pre class="file-text">{file.text}</pre>
      )}
    </article>
  );
}

/** Returns the page of the file called name in the project in dir,
 * which last changed at at. */
export function FileView({ dir, name, at, state }: { dir: string; name: string; at: number | null; state: State | null }) {
  const [file, error, fetchedAt, refresh] = useFile(dir, name, at);
  return (
    <div class="diffs">
      <h2>
        <a href="#projects">Projects</a> / <a href={projectHref(dir)}>{dir.split("/").pop()}</a> / {name}
        <Refresh at={fetchedAt} onClick={refresh} title="Read it again" />
      </h2>
      <FileBody dir={dir} name={name} file={file} error={error} state={state} />
    </div>
  );
}

/** Returns the file called name in the project in dir, which last
 * changed at at, to show within another page. */
export function FileSection({ dir, name, at, state }: { dir: string; name: string; at: number | null; state: State | null }) {
  const [file, error] = useFile(dir, name, at);
  return <FileBody dir={dir} name={name} file={file} error={error} state={state} />;
}

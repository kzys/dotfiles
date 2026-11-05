// The page of a file of a project: Markdown rendered, anything else as
// plain text.

import { useEffect, useRef } from "preact/hooks";
import { renderMarkdown } from "./markdown.ts";
import { projectHref } from "./pages.ts";
import { Refresh, useFetched } from "./ui.tsx";

type FileText = { text?: string; error?: string };

/** Returns the file called name in the project in dir as useFetched
 * does, fetched again whenever at, when it last changed, does. */
function useFile(dir: string, name: string, at: number | null) {
  const fetched = useFetched<FileText>(
    `/api/file?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`,
  );
  // useFetched fetches it first; fetch again only on changes.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else fetched[3]();
  }, [at]);
  return fetched;
}

/** Returns what file, called name, says, or why it can't be shown. */
function FileBody({ name, file, error }: { name: string; file: FileText | null; error: string | null }) {
  if (error) return <p class="empty">Couldn't read it: {error}</p>;
  if (!file) return <p class="empty">Reading…</p>;
  if (file.text === undefined) return <p class="empty">{file.error}</p>;
  return (
    <article class="card file-page">
      {name.toLowerCase().endsWith(".md") ? (
        <div class="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(file.text) }} />
      ) : (
        <pre class="file-text">{file.text}</pre>
      )}
    </article>
  );
}

/** Returns the page of the file called name in the project in dir,
 * which last changed at at. */
export function FileView({ dir, name, at }: { dir: string; name: string; at: number | null }) {
  const [file, error, fetchedAt, refresh] = useFile(dir, name, at);
  return (
    <div class="diffs">
      <h2>
        <a href="#projects">Projects</a> / <a href={projectHref(dir)}>{dir.split("/").pop()}</a> / {name}
        <Refresh at={fetchedAt} onClick={refresh} title="Read it again" />
      </h2>
      <FileBody name={name} file={file} error={error} />
    </div>
  );
}

/** Returns the file called name in the project in dir, which last
 * changed at at, to show within another page. */
export function FileSection({ dir, name, at }: { dir: string; name: string; at: number | null }) {
  const [file, error] = useFile(dir, name, at);
  return <FileBody name={name} file={file} error={error} />;
}

// The page of a file of a project: Markdown rendered, anything else as
// plain text.

import { useEffect, useRef } from "preact/hooks";
import { renderMarkdown } from "./markdown.ts";
import { Refresh, useFetched } from "./ui.tsx";

/** Returns the page of the file called name in the project in dir,
 * fetched again whenever at, when it last changed, does. */
export function FileView({ dir, name, at }: { dir: string; name: string; at: number | null }) {
  const [file, error, fetchedAt, refresh] = useFetched<{ text?: string; error?: string }>(
    `/api/file?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`,
  );
  // useFetched fetches it first; fetch again only on changes.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else refresh();
  }, [at]);
  return (
    <div class="diffs">
      <h2>
        <a href="#">Projects</a> / {dir.split("/").pop()} / {name}
        <Refresh at={fetchedAt} onClick={refresh} title="Read it again" />
      </h2>
      {error ? (
        <p class="empty">Couldn't read it: {error}</p>
      ) : !file ? (
        <p class="empty">Reading…</p>
      ) : file.text === undefined ? (
        <p class="empty">{file.error}</p>
      ) : (
        <article class="card file-page">
          {name.toLowerCase().endsWith(".md") ? (
            <div class="markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(file.text) }} />
          ) : (
            <pre class="file-text">{file.text}</pre>
          )}
        </article>
      )}
    </div>
  );
}

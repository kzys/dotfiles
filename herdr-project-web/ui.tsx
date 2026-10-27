// Pieces the page's views share.

import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { linkParts } from "./inbox.ts";

// The URLs of the open pull requests by their labels, like name#N.
export const Links = createContext<Record<string, string>>({});

/** Returns text with URLs, and the labels of pull requests in Links, as
 * links. */
export function Linked({ text }: { text: string }) {
  return (
    <>
      {linkParts(text, useContext(Links)).map(([p, href]) =>
        href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** Reports whether any of texts contains query, ignoring case. */
export const matches = (query: string, ...texts: (string | null)[]) =>
  !query || texts.some((t) => t?.toLowerCase().includes(query));

/** Returns what url says, as JSON, fetched again by refresh and
 * whenever the window regains focus, and when it was fetched. */
export function useFetched<T>(url: string): [T | null, string | null, Date | null, () => void] {
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
export function Refresh({ at, onClick, title = "Ask git again" }: { at: Date | null; onClick: () => void; title?: string }) {
  return (
    <button class="copy" onClick={onClick} title={title}>
      {at ? at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "…"} ↻
    </button>
  );
}

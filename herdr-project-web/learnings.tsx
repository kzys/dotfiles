// The page's view of the LEARNINGS.md files in ~/repos.

import type { Learnings, Topic } from "./learnings.ts";
import { Inline, Refresh, matches, useFetched } from "./ui.tsx";

/** Returns the topics of l matching query: all of a topic whose heading
 * matches, or else those of its items that do. */
function matching(l: Learnings, query: string): Topic[] {
  const has = (t: string) => matches(query, t);
  if (!query || has(l.org)) return l.topics;
  return l.topics
    .map((t) => (has(t.heading) ? t : { ...t, items: t.items.filter(has) }))
    .filter((t) => has(t.heading) || t.items.length);
}

const topicId = (org: string, i: number) => `learn-${org}-${i}`;

/** Returns the topics of each LEARNINGS.md in ~/repos matching query,
 * with an index of their headings. */
export function LearningsView({ query }: { query: string }) {
  const [learnings, error, at, refresh] = useFetched<Learnings[]>("/api/learnings");
  const shown = (learnings ?? [])
    .map((l) => ({ ...l, topics: matching(l, query) }))
    .filter((l) => l.topics.length);
  return (
    <div class="diffs">
      <h2>
        Learnings <Refresh at={at} onClick={refresh} title="Read them again" />
      </h2>
      {error && <p class="empty">Couldn't read them: {error}</p>}
      {!learnings ? (
        !error && <p class="empty">Reading…</p>
      ) : !shown.length ? (
        <p class="empty">{query ? "No match." : "No LEARNINGS.md in ~/repos."}</p>
      ) : (
        shown.map((l) => (
          <div key={l.org} class="learn-org">
            <nav class="card learn-index" aria-label={`${l.org} topics`}>
              <header>
                <span class="name">{l.org}</span>
                <span class="title" title={l.path}>
                  {l.path}
                </span>
              </header>
              <ul>
                {l.topics.map((t, i) => (
                  <li key={i}>
                    <button
                      onClick={() =>
                        document.getElementById(topicId(l.org, i))?.scrollIntoView({ behavior: "smooth" })
                      }
                    >
                      <Inline text={t.heading} links={false} />
                    </button>
                    <span class="learn-count">{t.items.length}</span>
                  </li>
                ))}
              </ul>
            </nav>
            <div class="card learn-topics">
              {l.topics.map((t, i) => (
                <section key={i} class="learn-topic" id={topicId(l.org, i)}>
                  <h3>
                    <Inline text={t.heading} />
                  </h3>
                  <ul>
                    {t.items.map((item, j) => (
                      <li key={j}>
                        <Inline text={item} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// The page's view of what the watcher found: pull requests, Slack,
// Linear and the rest of its sections.

import { uniqueKeys } from "./inbox.ts";
import { type AgentState, agentState, readiness, runsByState } from "./pulls.ts";
import type { Entry, PullRequest, Run, Section, State } from "./state.ts";
import { Linked, matches } from "./ui.tsx";

/** Returns how the checks of a pull request went, for its status dot,
 * from their rollup state. */
function checksState(checks: string | null): [string, string] {
  if (checks === "SUCCESS") return ["passed", "Checks passed"];
  if (checks === "FAILURE" || checks === "ERROR") return ["failed", "Checks failed"];
  if (checks === "PENDING" || checks === "EXPECTED") return ["pending", "Checks running"];
  return ["none", "No checks"];
}

/** Returns the names of runs, each linked to its details if known. */
function RunNames({ runs }: { runs: Run[] }) {
  return (
    <>
      {uniqueKeys(runs.map((r) => r.name)).map((key, i) => {
        const r = runs[i];
        return (
          <span key={key}>
            {i > 0 && ", "}
            {r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.name}
              </a>
            ) : (
              r.name
            )}
          </span>
        );
      })}
    </>
  );
}

/** Returns a bar of pr's checks, a segment for each by state, and what
 * failed or still runs. */
function Checks({ pr }: { pr: PullRequest }) {
  const by = runsByState(pr);
  const total = pr.runs?.length ?? 0;
  if (!total) return null;
  return (
    <div class="runs">
      <div class="runs-bar" aria-hidden="true">
        {(["passed", "skipped", "cancelled", "failed", "running"] as const).map(
          (state) =>
            by[state].length > 0 && (
              <span key={state} class={`run-${state}`} style={{ flexGrow: by[state].length }} />
            ),
        )}
      </div>
      <span class="runs-count">
        {by.passed.length}/{total} passed
      </span>
      {by.failed.length > 0 && (
        <span class="runs-failed">
          failed: <RunNames runs={by.failed} />
        </span>
      )}
      {by.running.length > 0 && (
        <span class="runs-running">
          running: <RunNames runs={by.running} />
        </span>
      )}
      {!by.failed.length && !by.running.length && (
        <span class="runs-done">all done</span>
      )}
    </div>
  );
}

const AGENT_LABELS: Record<AgentState, string> = {
  working: "agent working",
  blocked: "agent needs you",
  idle: "agent idle",
  unknown: "agent on it",
};

function PullRequestRow({
  pr,
  agents,
}: {
  pr: PullRequest;
  agents: Record<string, string> | null;
}) {
  const [state, label] = checksState(pr.checks);
  const agent = agentState(pr, agents);
  const [ready, kind] = readiness(pr, agent);
  // When the agent decides the pill, the pill says what it does.
  const agentInPill = ready !== readiness(pr)[0];
  return (
    <li class="pr">
      <span class={`checks checks-${state}`} title={label} aria-label={label} />
      <div class="pr-main">
        <a class="pr-title" href={pr.url} target="_blank" rel="noreferrer">
          {pr.title}
        </a>
        <span class={`badge badge-${kind}`}>{ready}</span>
        <div class="pr-meta">
          <span class="pr-label">
            {pr.repo}#{pr.number}
          </span>
          {pr.project && <span class="workspace">{pr.project}</span>}
          {agent && !agentInPill && (
            <span class={`pr-agent agent-${agent}`}>{AGENT_LABELS[agent]}</span>
          )}
          {!pr.runs && pr.failed.length > 0 && (
            <span class="pr-failed">failed: {pr.failed.join(", ")}</span>
          )}
        </div>
        <Checks pr={pr} />
      </div>
    </li>
  );
}

/** Returns a Slack conversation or Linear issue as a row like a pull
 * request's, its lamp lit if it waits on the user, and dimmed if done. */
function EntryRow({ entry }: { entry: Entry }) {
  const [lamp, label] = entry.waiting
    ? ["failed", "Waiting on you"]
    : entry.done
      ? ["passed", "Done"]
      : ["none", "Nothing asked of you"];
  return (
    <li class={entry.done ? "pr entry-done" : "pr"}>
      <span
        class={`checks checks-${lamp}`}
        title={label}
        aria-label={label}
      />
      <div class="pr-main">
        {entry.url ? (
          <a class="pr-title" href={entry.url} target="_blank" rel="noreferrer">
            {entry.title}
          </a>
        ) : (
          <span class="pr-title">{entry.title}</span>
        )}
        {entry.waiting && <span class="badge badge-bad">your turn</span>}
        {entry.done && <span class="badge badge-ok">done</span>}
        <div class="pr-meta">
          <span class="pr-label">{entry.label}</span>
          {entry.detail && <span>{entry.detail}</span>}
          {entry.project && <span class="workspace">{entry.project}</span>}
        </div>
        {entry.note && (
          <p class="entry-note">
            <Linked text={entry.note} />
          </p>
        )}
      </div>
    </li>
  );
}

function WatchSection({
  section,
  query,
  agents,
  now,
}: {
  section: Section;
  query: string;
  agents: Record<string, string> | null;
  now: number;
}) {
  const hhmm = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
  const at = hhmm(section.at);
  // Past its next check, the section is being checked, which may take a
  // while, as for those that ask Claude.
  const due = section.next ? Date.parse(section.next) <= now : false;
  const next = hhmm(section.next);
  const prs = section.pullRequests?.filter((pr) =>
    matches(query, pr.title, pr.repo, pr.label, pr.project));
  const entries = section.entries?.filter((e) =>
    matches(query, e.title, e.label, e.note ?? null, e.detail ?? null, e.project));
  return (
    <section class="watch">
      <h3>
        {section.title}
        {at && (
          <span class="checked">
            <time dateTime={section.at!}>{at}</time>
            {next &&
              (due ? (
                " · checking…"
              ) : (
                <>
                  {" · next "}
                  <time dateTime={section.next!}>{next}</time>
                </>
              ))}
          </span>
        )}
      </h3>
      {prs ? (
        prs.length ? (
          <ul class="prs">
            {prs.map((pr) => (
              <PullRequestRow key={pr.url} pr={pr} agents={agents} />
            ))}
          </ul>
        ) : (
          <p class="empty">{query ? "No match." : "None open."}</p>
        )
      ) : entries ? (
        entries.length ? (
          <ul class="prs">
            {uniqueKeys(entries.map((e) => `${e.label}:${e.url ?? e.title}`)).map((key, i) => (
              <EntryRow key={key} entry={entries[i]} />
            ))}
          </ul>
        ) : (
          <p class="empty">{query ? "No match." : "Nothing."}</p>
        )
      ) : section.lines.length ? (
        <pre>
          {section.lines.map((l, i) => (
            <div key={i}>
              <Linked text={l} />
            </div>
          ))}
        </pre>
      ) : (
        <p class="empty">Nothing.</p>
      )}
    </section>
  );
}

/** Returns the watcher's sections in state, matching query. */
export function WatcherColumn({ state, query, now }: { state: State; query: string; now: number }) {
  return (
    <div class="column">
      <h2>Watcher</h2>
      {state.sections ? (
        state.sections.map((s) => (
          <WatchSection key={s.title} section={s} query={query} agents={state.agents ?? null} now={now} />
        ))
      ) : (
        <p class="empty">
          Nothing from the watcher yet. Run <code>herdr-project --watch</code>.
        </p>
      )}
    </div>
  );
}

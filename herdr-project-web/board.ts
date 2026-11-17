// The board of the user's pull requests, each in the column of how far
// it has come.

import type { CopilotReview, Pull } from "./github.ts";
import type { Owner } from "./owners.ts";

// The board's columns, in order.
export const STAGES = [
  ["draft", "Draft"],
  ["copilot", "Copilot review passed"],
  ["reviewed", "Human review passed"],
  ["approved", "All approved"],
  ["merged", "Merged"],
] as const;

export type Stage = (typeof STAGES)[number][0];

// How long a merged pull request stays on the board.
export const MERGED_MS = 86400_000;

// A pull request as the board shows it.
export type Card = {
  url: string;
  label: string;
  title: string;
  stage: Stage;
  draft: boolean;
  checks: string | null;
  copilot: CopilotReview;
  // Whether the user has marked it reviewed.
  reviewed: boolean;
  // The name and directory of its project, or null.
  project: string | null;
  projectDir: string | null;
};

/** Returns the column of pr: the furthest it has come, whether or not
 * it passed the stages before. reviewed is whether the user marked it
 * reviewed. */
export function stage(pr: Pull, reviewed: boolean): Stage {
  if (pr.state === "MERGED") return "merged";
  if (pr.review === "APPROVED") return "approved";
  if (reviewed) return "reviewed";
  if (pr.copilot === "passed") return "copilot";
  return "draft";
}

/** Returns the cards of prs for the board at now: the open ones and those
 * merged within MERGED_MS, with their projects from owners (by url),
 * named by name, marked reviewed if in reviewed, the URLs the user
 * marked. */
export function cards(
  prs: Pull[], owners: Record<string, Owner | null>, name: (dir: string) => string, reviewed: Set<string>, now: Date,
): Card[] {
  const shown = (pr: Pull) =>
    pr.state === "OPEN" || (pr.state === "MERGED" && !!pr.mergedAt && now.getTime() - Date.parse(pr.mergedAt) < MERGED_MS);
  return prs.filter(shown).map((pr) => {
    const dir = owners[pr.url]?.project ?? null;
    return {
      url: pr.url,
      label: `${pr.repo.split("/")[1]}#${pr.number}`,
      title: pr.title,
      stage: stage(pr, reviewed.has(pr.url)),
      draft: pr.draft,
      checks: pr.checks,
      copilot: pr.copilot,
      reviewed: reviewed.has(pr.url),
      project: dir ? name(dir) : null,
      projectDir: dir,
    };
  });
}

/** Returns the URLs in reviewed except those prs has as closed or merged.
 * A pull request the search doesn't find may still be open, so its mark
 * stays, even if it closed unseen. */
export function stillReviewed(reviewed: Iterable<string>, prs: Pull[]): string[] {
  const done = new Set(prs.filter((p) => p.state !== "OPEN").map((p) => p.url));
  return [...reviewed].filter((u) => !done.has(u));
}

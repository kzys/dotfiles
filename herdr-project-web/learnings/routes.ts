// The server's route behind the page's view of what earlier tasks learned.

import type { Hono } from "hono";
import { readLearnings } from "./learnings.ts";

/** Adds the learnings route to routes: the LEARNINGS.md files under
 * reposRoot, as readLearnings reads them. They are small and change
 * rarely, so they are read each time. */
export function routeLearnings(routes: Hono, reposRoot: string) {
  routes.get("/learnings", (c) => c.json(readLearnings(reposRoot)));
}

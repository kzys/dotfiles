// Runs the watcher's polls, then serves the page. The polls keep running
// even if the page fails, as when its code is broken or its port taken.

import type { Readable } from "node:stream";
import { readReports, startPoller, stayWithPoller } from "./poller.ts";

const poller = startPoller(process.env);
if (poller) {
  readReports(poller.stdio[3] as Readable);
  stayWithPoller(poller);
  process.on("uncaughtException", (e) => console.error("herdr-project-web:", e));
  process.on("unhandledRejection", (e) => console.error("herdr-project-web:", e));
}
await import("./server.ts");

// Runs the watcher's polls, then serves the page. The polls keep running
// even if the page fails, as when its code is broken or its port taken.

import { startPoller, stayWithPoller } from "./poller.ts";

const poller = startPoller(process.env);
if (poller) {
  stayWithPoller(poller);
  process.on("uncaughtException", (e) => console.error("herdr-project-web:", e));
  process.on("unhandledRejection", (e) => console.error("herdr-project-web:", e));
}
await import("./server.ts");

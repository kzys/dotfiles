// Serves the page, and as the watcher, run by herdr-project --watch,
// checks what waits on the user. The checks keep running even if the
// page fails, as when its port is taken.

import { unlinkSync } from "node:fs";

if (process.env.HERDR_PROJECT_ORGS) {
  process.on("uncaughtException", (e) => console.error("herdr-project-web:", e));
  process.on("unhandledRejection", (e) => console.error("herdr-project-web:", e));
  // Ctrl-C stops the watcher for good: zshrc no longer resumes it in its
  // pane, which $HERDR_PROJECT_WATCHER_FILE records.
  process.on("SIGINT", () => {
    try {
      if (process.env.HERDR_PROJECT_WATCHER_FILE) unlinkSync(process.env.HERDR_PROJECT_WATCHER_FILE);
    } catch {}
    process.exit(0);
  });
}
await import("./server.ts");

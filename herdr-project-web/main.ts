// Serves the page, and as the watcher, run by herdr-project --watch,
// checks what waits on the user. The checks keep running even if the
// page fails, as when its port is taken.

if (process.env.HERDR_PROJECT_ORGS) {
  process.on("uncaughtException", (e) => console.error("herdr-project-web:", e));
  process.on("unhandledRejection", (e) => console.error("herdr-project-web:", e));
}
await import("./server.ts");
export {};

// Runs herdr-project --watch, --start-watch, --background or --supervise.

import { main } from "./watch.ts";

await main(process.argv.slice(2));

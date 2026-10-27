// Asking a headless Claude session, which has the user's claude.ai
// connectors, for structured data.

import { spawn } from "node:child_process";

/** Returns the output of command with args run in cwd, if given, with no
 * input. Raises if it fails or takes longer than timeoutMs. */
export function run(command: string, args: string[], timeoutMs: number, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Killed outright, so that one ignoring SIGTERM can't hold its caller.
    const child = spawn(command, args, {
      cwd, stdio: ["ignore", "pipe", "ignore"], timeout: timeoutMs, killSignal: "SIGKILL",
    });
    const out: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
      else reject(new Error(`${command} failed: ${signal ?? code}`));
    });
  });
}

/** Returns field of the output, matching schema, of a headless Claude
 * session, command, in stateDir that may only use tools to answer
 * prompt. Raises if it fails. */
export async function ask(
  stateDir: string,
  prompt: string,
  schema: object,
  tools: string[],
  field: string,
  command = "claude",
): Promise<any> {
  const out = await run(
    command,
    ["-p", "--no-session-persistence", "--model", "sonnet", "--output-format", "json", "--max-budget-usd", "2",
     "--json-schema", JSON.stringify(schema), "--allowedTools", ...tools, "--", prompt],
    900_000,
    stateDir,
  );
  return structured(JSON.parse(out), field);
}

/** Returns field of the structured output in result, the JSON output of
 * claude -p. Raises if Claude didn't produce it. */
export function structured(result: any, field: string): any {
  const found = result?.structured_output?.[field];
  if (result?.is_error || found === undefined || found === null) throw new Error(result?.result || `no ${field}`);
  return found;
}

/** Returns the names of the claude.ai connectors that listing, the output
 * of claude mcp list, shows as connected, like Slack. */
export function connected(listing: string): Set<string> {
  const names = new Set<string>();
  for (const line of listing.split("\n")) {
    const at = line.lastIndexOf(" - ");
    if (line.startsWith("claude.ai ") && at >= 0 && line.slice(at + 3).includes("Connected"))
      names.add(line.slice("claude.ai ".length, at).split(":", 1)[0]);
  }
  return names;
}

/** Returns the names of the user's connected claude.ai connectors, as
 * command's mcp list shows them, or null if it fails. */
export async function connectors(command = "claude"): Promise<Set<string> | null> {
  try {
    return connected(await run(command, ["mcp", "list"], 120_000));
  } catch {
    return null;
  }
}

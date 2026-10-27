// Asking Herdr through its socket, one request per connection, as its
// CLI does, rather than running the CLI each time.

import { createConnection } from "node:net";

// An error Herdr replied with, as opposed to failing to reach it.
export class HerdrError extends Error {}

/** Sends method with params to the Herdr socket at path and returns the
 * result of its reply. Raises if Herdr replies with an error, or hasn't
 * replied in full within timeoutMs. */
export function request(path: string, method: string, params: object = {}, timeoutMs = 10_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = "";
    const fail = (e: Error) => {
      socket.destroy();
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error(`herdr ${method}: no reply in ${timeoutMs}ms`)), timeoutMs);
    socket.on("close", () => clearTimeout(timer));
    socket.on("error", fail);
    // Whole characters, even where one spans two reads.
    socket.setEncoding("utf8");
    socket.on("data", (data) => {
      buffer += data;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      socket.end();
      let reply: { result?: unknown; error?: { code?: string; message?: string } };
      try {
        reply = JSON.parse(buffer.slice(0, end));
      } catch {
        return reject(new Error(`herdr ${method}: bad reply`));
      }
      if (reply.error)
        reject(new HerdrError(`herdr ${method}: ${reply.error.code ?? "error"}: ${reply.error.message ?? ""}`));
      else resolve(reply.result);
    });
    socket.on("end", () => reject(new Error(`herdr ${method}: no reply`)));
    socket.write(`${JSON.stringify({ id: method, method, params })}\n`);
  });
}

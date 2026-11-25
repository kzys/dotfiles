// What the server's routes share: bounding and reading request bodies,
// and refusing requests from where they may not come.

import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

// Far more than any request needs, to bound what's kept in memory.
const MAX_BODY = 1 << 20;

/** Returns middleware that refuses a request whose body is too large to
 * keep, with what tooLarge returns. */
export const limit = (tooLarge = (c: Context): Response => c.body(null, 413)) =>
  bodyLimit({ maxSize: MAX_BODY, onError: tooLarge });

/** Returns middleware that refuses with 403 a request whose headers
 * allowed refuses. */
export const only = (allowed: (headers: Headers) => boolean) =>
  createMiddleware(async (c, next) => (allowed(c.req.raw.headers) ? next() : c.body(null, 403)));

/** Returns the JSON object in the body of c's request, or {} if it is
 * empty. Raises an HTTPException that replies 400 if it isn't one. */
export async function jsonBody(c: Context): Promise<Record<string, any>> {
  let body: unknown;
  try {
    const text = await c.req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    body = null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new HTTPException(400, { res: Response.json({ error: "not JSON" }, { status: 400 }) });
  return body as Record<string, any>;
}

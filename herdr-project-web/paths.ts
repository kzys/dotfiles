// Paths, for the server and the page alike.

/** Reports whether path, if any, is dir or under it. */
export function within(dir: string, path: string | null | undefined): boolean {
  return !!path && (path === dir || path.startsWith(`${dir.replace(/\/+$/, "")}/`));
}

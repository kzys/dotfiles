# herdr-project-web

The watcher serves this checkout at http://127.0.0.1:9000/. After editing
the server or the page here, run `npm test` and `npm run check`, then
`touch restart.stamp` to restart it, without being asked. A server that
crashes is started again within seconds, over and over, and meanwhile the
hooks, `hp` and the picker wait on it, so don't restart on failing code.

Edits in a worktree don't reach :9000. Open pages only reload themselves
when the commit changes, so after uncommitted edits, tell the user to
reload.

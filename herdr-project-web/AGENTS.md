# herdr-project-web

The watcher serves this checkout at http://127.0.0.1:9000/. After editing
the server or the page here, run `npm test` and `npm run check`, then
`touch restart.stamp` to restart it, without being asked. A crash stops
the hooks, `hp` and the picker until the stamp is touched again, so don't
restart on failing code.

Edits in a worktree don't reach :9000. Open pages only reload themselves
when the commit changes, so after uncommitted edits, tell the user to
reload.

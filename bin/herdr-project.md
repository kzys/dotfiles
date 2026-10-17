Git checkouts of Baseten repositories are under ~/baseten/. Use them
instead of cloning.

Make a git worktree in the current directory to work on a branch;
don't switch branches in an existing checkout. $dotfiles is the
exception: tools read their config from that checkout, so start a
branch there with git switch -c from where it is, and don't switch to
other branches.

The current directory ($PWD) is this session's scratch directory, and
other agents may work in it too, sharing what they learn there. Read
README.md and the "## Remaining" and "## Findings" sections of each
AGENT-*.md there first, if they exist; read their logs only when you
need the history of earlier work.

README.md describes the task for all agents. Start it with front
matter giving the task a title of at most 60 characters and a short
name of at most 20 characters:

---
title: <title>
name: <name>
---

Write README.md if it doesn't exist; otherwise change it only when the
task itself changes. If you take this directory over for a different
task, rewrite README.md for it and mark each other agent's remaining
items as done or moved in your own notes.

Keep your own notes in AGENT-<role>.md with what you have done so far,
where <role> is a short name for your part, such as main or reviewer.
Write only to your own file. When resuming another agent's work, keep
using its file, but only if that agent has stopped: if another agent
pane in `herdr pane list` is in this directory, it is still working, so
pick a role of your own. The session started at $start; check the time
with date and update your notes about every hour, and before you finish.

Start your notes, after any closed line (see below), with a
"## Remaining" section listing what's left to
do or decide, and keep it current; a pane shows it to the user. Make
each item a line starting with "- ", and put right after that [you] when it
waits on the user to decide or do something, [wait] when it waits on
someone else or on CI, or [cleanup] when it is something to tidy up,
such as a worktree, a branch, a test cluster or a cordoned node; the
user's inbox lists the [you] items. Remove items once they are done,
including pull requests that merged or closed. After it, keep a
"## Findings" section of short facts that other agents here would need,
such as how a system behaves, a constraint or a decision, and fix or
drop those that turn out wrong. Put the log of what you have done under
"## Log" after that, starting each entry with the date, time and zone,
like 2026-10-16 14:50 PDT. Once you know
your role, report it so that the pane shows your section, at the start
of every session, including resumed ones, since a resumed session runs
in a new pane:
herdr pane report-metadata "$HERDR_PANE_ID" --source agent-notes --token role=<role>

About 5 minutes after the session started, once the task is clear,
write README.md if needed and rename the Herdr workspace to its name,
once:
herdr-name-workspace <name>

When your part is done but other work in this directory goes on, close
your role. Add this line at the top of your notes, before
"## Remaining", with a link to what carries your outcome, such as a pull
request or a ticket, or a few words on it if nothing does:

closed: <link>

Then empty "## Remaining" and keep "## Findings" for the other agents.
You may cut your log down to what the link and your findings don't
already say. If you take the role up again, remove the closed line.

When the user says the task is done, close the project, so that its
directory can be deleted:

1. Read every .md file in this directory, including other agents'
   notes, and make sure nothing is left behind: each open item is done,
   or carried by what you close the project with.
2. Keep what a later task would need to know, starting from every
   agent's "## Findings", such as how a system behaves, a fix that
   worked or a step that is easy to get wrong, where the closing rules
   below say, or else in the user's instructions after asking them.
   Leave out this task's history.
3. Follow the closing rules below, if any, then add a closed field to
   the front matter of README.md with a link to what carries the
   outcome and any remaining work, such as a pull request or a ticket,
   or a few words on the outcome if nothing does, and empty your
   "## Remaining" section:

   closed: <link>

4. Offer to delete the directory, after checking that no other agent
   pane in `herdr pane list` is in it and listing what else it holds,
   such as scripts, logs and data. Delete it only if the user agrees.
   Remove its git worktrees first with git worktree remove, never with
   --force: if one has uncommitted changes or a branch that isn't
   pushed, stop and tell the user.

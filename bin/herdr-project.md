Git checkouts of Baseten repositories are under ~/baseten/. Use them
instead of cloning.

Make a git worktree in the current directory to work on a branch;
don't switch branches in an existing checkout. ~/ws/dotfiles is the
exception: tools read their config from that checkout, so start a
branch there with git switch -c from where it is, and don't switch to
other branches.

The current directory ($PWD) is this session's scratch directory, and
other agents may work in it too. Read README.md and AGENT-*.md there
first, if they exist; they record earlier work.

README.md describes the task for all agents. Start it with front
matter giving the task a title of at most 60 characters and a short
name of at most 20 characters:

---
title: <title>
name: <name>
---

Write README.md if it doesn't exist; otherwise change it only when the
task itself changes. If NOTES.md exists, it is from an older layout:
move its contents to README.md and AGENT-main.md, then delete it.

Keep your own notes in AGENT-<role>.md with what you have done so far,
where <role> is a short name for your part, such as main or reviewer.
Write only to your own file. When resuming another agent's work, keep
using its file. The session started at $start; check the time with
date and update your notes about every hour, and before you finish.

About 5 minutes after the session started, once the task is clear,
write README.md if needed and rename the Herdr workspace to its name,
once:
herdr-name-workspace <name>

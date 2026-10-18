# Project directory

These instructions come from `$dotfiles/PROJECT.md`, followed by
`$dotfiles/work/PROJECT.md` if it exists.

Each task has a scratch directory under `~/project`; this task's is
`$PWD`. Other agents may work in it too, sharing what they learn there:

```
~/project/
└── <date>-<id>/           this task's directory
    ├── README.md          the task, for all agents
    ├── AGENT-<role>.md    each agent's notes
    ├── <worktree>/        git worktrees for branches
    └── ...                scripts, logs and data for the task
```

Read `README.md` and the `## Remaining` and `## Findings` sections of
each `AGENT-*.md` first, if they exist; read their logs only when you
need the history of earlier work.

## README.md

`README.md` describes the task for all agents, after this front
matter:

```
---
title: <title>
name: <name>
---
```

- `title`: the task, in at most 60 characters.
- `name`: a short name for the task, in at most 20 characters.
- `repositories`: added only when the task works in checkouts under
  `~/repos` directly rather than in worktrees here, as
  `repositories: ~/repos/<org>/<repo>`, separated by spaces if more
  than one. Without it, the checkouts are those this directory's notes
  name.
- `closed`: added only when the project is closed, as `closed: <link>`.
  A link to what carries the outcome and any remaining work, such as a
  pull request or a ticket, or a few words on the outcome if nothing
  does.

Write `README.md` if it doesn't exist, without `closed`; otherwise
change it only when the task itself changes. If you take this
directory over for a different task, rewrite `README.md` for it and
mark each other agent's remaining items as done or moved in your own
notes.

## `AGENT-<role>.md`

Each agent keeps its notes in `AGENT-<role>.md`, where `<role>` is a
short name for its part, such as `main` or `reviewer`, in this shape:

```
## Remaining

- [you] <item>

## Findings

- <fact>

## Log

- 2026-10-16 14:50 PDT <entry>
```

- `closed`: added only when the role is closed, as front matter at the
  top of the file (see Closing your role). A link to what carries the
  role's outcome, such as a pull request or a ticket, or a few words on
  it if nothing does.
- `## Remaining`: what's left to do or decide; keep it current, since a
  pane shows it to the user. Each item is a line starting with `- `,
  followed by `[you]` when it waits on the user to decide or do
  something, `[wait]` when it waits on someone else or on CI, or
  `[cleanup]` when it is something to tidy up, such as a worktree, a
  branch, a test cluster or a cordoned node.
  The user's inbox lists the `[you]` items. Remove items once they are
  done, including pull requests that merged or closed.
- `## Findings`: short facts that other agents here would need, such as
  how a system behaves, a constraint or a decision. Fix or drop those
  that turn out wrong.
- `## Log`: what you have done, each entry starting with the date, time
  and zone.

Write only to your own file. When resuming another agent's work, keep
using its file, but only if that agent has stopped: if another agent
pane in `herdr pane list` is in this directory, it is still working, so
pick a role of your own. The session started at $start; check the time
with `date` and update your notes about every hour, and before you
finish.

## Checkouts

Git checkouts are under `~/repos/<org>/<repo>`, named after the GitHub
organization and repository. Use them instead of cloning.

Make a git worktree in this task's directory to work on a branch;
don't switch branches in an existing checkout. `$dotfiles` is the
exception: tools read their config from that checkout, so start a
branch there with `git switch -c` from where it is, and don't switch to
other branches.

## Herdr

Once you know your role, report it so that the pane shows your
`## Remaining` section, at the start of every session, including
resumed ones, since a resumed session runs in a new pane:

```
herdr pane report-metadata "$HERDR_PANE_ID" --source agent-notes --token role=<role>
```

About 5 minutes after the session started, once the task is clear,
write `README.md` if needed and rename the Herdr workspace to its name,
once:

```
herdr-name-workspace <name>
```

## Closing your role

When your part is done but other work in this directory goes on, close
your role: add this front matter to the top of your notes and empty
`## Remaining`, keeping `## Findings` for the other agents. You may cut
your log down to what the link and your findings don't already say. If
you take the role up again, remove it.

```
---
closed: <link>
---
```

## Closing the project

When the user says the task is done, close the project, so that its
directory can be deleted:

1. Read every `.md` file in this directory, including other agents'
   notes, and make sure nothing is left behind: each open item is done,
   or carried by what you close the project with.
2. Keep what a later task would need to know, starting from every
   agent's `## Findings`, such as how a system behaves, a fix that
   worked or a step that is easy to get wrong. Append it to
   `~/repos/<org>/LEARNINGS.md` for the GitHub organization it is about,
   or `~/repos/kzys/LEARNINGS.md` if it is about none, under a heading
   for the system or topic, unless it is already there. Leave out this
   task's history.
3. Follow the closing rules below, if any, then add `closed` to the
   front matter of `README.md` and empty your `## Remaining` section.
4. Offer to delete the directory, after checking that no other agent
   pane in `herdr pane list` is in it and listing what else it holds,
   such as scripts, logs and data. Delete it only if the user agrees.
   Remove its git worktrees first with `git worktree remove`, never with
   `--force`: if one has uncommitted changes or a branch that isn't
   pushed, stop and tell the user.

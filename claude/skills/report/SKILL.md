---
name: report
description: How to write a page or write-up for the user to read or share, such as a review, a tour of a repository, findings from a session, or a debugging investigation ("why does X behave this way"), in HTML or Markdown. Covers wording, structure and visual design. Use when producing such a page, not for chat answers, commit messages, PR descriptions or code comments.
---

# report

Rules for pages and write-ups. They cover how the page reads and looks, not
where it goes: publish it however the request or another skill says.

## Content

- Lead with what the reader needs: what the thing is, then what matters.
- Say what you verified and how ("ran `--check`", "compared the deployed
  files"), and say plainly what you didn't. Don't present a guess as a
  finding.
- Verify against what is actually installed (`--version`, the package
  manager, man pages) rather than memory of how a tool behaves.
- Tie each claim to a source: `path:line`, a commit, or command output.
  Quote real excerpts instead of paraphrasing code, and pin them to a
  released tag, the installed version, or the exact commit you read, not a
  moving branch.
- Link each `path:line` and excerpt to the hosted source, private repos
  included, at exactly the tag or commit it is pinned to, in the host's
  permalink format. On GitHub that is
  `https://github.com/<owner>/<repo>/blob/<ref>/<path>#L6-L7`, with
  `?plain=1` before the `#` for Markdown and other rendered files. Link
  only refs the hosted remote has: check a tag with
  `git ls-remote --exit-code <remote> refs/tags/<tag>`, and a commit with
  `git branch -r --contains <sha>` after a `git fetch`. Otherwise leave the
  reference as plain text and say it isn't on the remote.
- For findings, order by how much they matter, and give each one a concrete
  fix.
- Leave out what you didn't read rather than guessing, and say that you
  left it out.
- Keep it short. Cut any sentence that doesn't change what the reader knows.

## Investigations

For a root-cause write-up, use three sections in this order and no others:

1. **Problem**: the symptom as the user sees it, shown rather than described
   (a reproduction, a capture, a before and after), and how it was
   reproduced.
2. **Why**: the mechanism. Lead with the raw signal (terminal capture,
   payload, error string), then explain what produced it. Root cause first,
   not the story of how you found it.
3. **Solutions**: one row per affected component, with its status (fixable,
   not fixable, works by default, tracked upstream) and the concrete fix.

Close with a footer of one or two lines, not a section, naming the exact
versions checked and any upstream issue. An investigation has no hero; the
Problem section opens the page.

## Wording

- Name headings for what the section contains: "What it is", "How Ansible
  fits in", "What could be improved".
- No "This is X, not Y" titles or contrast framing, no clever headlines,
  no selling.
- Plain verbs, sentence case, active voice.

## Design

These rules are for HTML pages. For Markdown, follow the Content and Wording
rules and keep formatting to headings, lists and code blocks.

Styling must carry meaning. Before adding any visual device, ask what it
tells the reader. If the answer is "nothing", leave it out.

- No eyebrow labels above headings, no all-caps labels, no badges with
  dots, no meta strings joined with middle dots, no "→" on links.
- Number things only when they are a real sequence, such as steps in a
  chain.
- Color only where it encodes something, and explain the code once if it
  isn't obvious (for example, one rule color for strengths and another for
  fixes).
- Monospace only for real paths, commands and code.
- One or two typefaces, a readable measure (under about 75 characters), and
  a layout that works at phone width and in dark mode.
- Pick the hero from the subject itself (for a repository, its file tree)
  rather than a big number or a gradient.
- Give each section heading a stable `id` so it can be linked.
- Look at the result, using a screenshot if you can, and fix what's wrong
  before calling it done.

## Revisions

When the user asks for a change to a published page, edit that page and keep
what they didn't mention. Don't rewrite it from scratch.

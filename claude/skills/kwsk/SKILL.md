---
name: kwsk
description: Publish a short technical investigation (a bug root-cause, a "why does X behave this way" writeup) as an Artifact in the kwsk case-file style — Problem / Why / Solutions structure, IBM Plex type, teal accent, real cited source-code excerpts. Use when the user asks to write up, document, or share findings from a debugging/investigation session as a page, not when they just want an answer in chat.
---

# kwsk

A personal template for turning a debugging or root-cause investigation into a
short, shareable Artifact page. Load `artifact-design` first as usual — this
skill only fixes the parts that are specific to this format; everything else
(theming, responsiveness, etc.) still follows that skill.

## When to use

The user has just chased down *why* something behaves unexpectedly (a
rendering bug, a config quirk, a library gotcha) and wants it written up as a
page they can revisit or share — not a plan, not a landing page, not a tool.
The giveaway is retrospective, single-subject, evidence-based writing: "here's
what's actually happening and why."

## Structure

Exactly three sections, in this order. Don't add more — if there's a fourth
category of content, it belongs inside one of these three, not a new section.

1. **Problem** — the observable symptom, from the user's point of view.
   Show it, don't just describe it: a reproduction box, a screenshot-like
   mock, or a short before/after. One sentence on how it was reproduced.
2. **Why** — the actual mechanism. Lead with any raw signal you captured
   (a byte-for-byte terminal capture, a network payload, an error string) in
   a code panel, then explain what produced it. Root cause first, not the
   chronology of how you found it.
3. **Solutions** — what's actually fixable, per affected target. A fix-table
   with one row per system/component, each with a status pill (fixable /
   not fixable / works by default / tracked upstream) and the concrete fix.

Do not add a numbered investigation log, a "verdict" narrative, or other
sequence-flavored components unless the content is a literal chronological
sequence — most write-ups aren't, they're a diagnosis, and numbering a
non-sequence is exactly the kind of decorative structure to avoid.

## Visual identity

- **Type**: IBM Plex Mono for headings, labels, eyebrows, and code; IBM Plex
  Sans for body prose. Load both from Google Fonts.
- **Palette**: cool, desaturated neutrals (not warm/cream) with a teal accent
  — e.g. bg `#eef1f2` / ink `#1b2023` / accent `#0e8a9a` in light,
  inverting to bg `#14171a` / ink `#e7ebec` / accent `#5fd0dd` in dark. Full
  light/dark token pairs per `artifact-design`'s rules, including the
  un-stamped `prefers-color-scheme` case.
- **Semantic status colors** for fix-table pills, separate from the accent:
  confirm/green, falsify/red, warn/amber.
- **Masthead**: uppercase eyebrow label (e.g. "domain · case file"), h1,
  one-sentence dek, a row of small pills for environment/version context
  (what was tested, on what).
- **Anchors**: every h1/h2 gets a stable `id` and a hover-reveal `#` anchor
  link (`scroll-margin-top` on the heading, `opacity:0` → `1` on
  `h1:hover .anchor` / `:focus-visible`, always visible under
  `@media (hover:none)`).

## Evidence panels

Keep real source excerpts, not paraphrased summaries — that's the point of
`kwsk`. For each piece of evidence:

- Cite file path and line range, and pin to an exact released version tag,
  never a dev-branch HEAD. If a version is actually installed on the
  machine, say so and verify the excerpt against that exact tag.
- Render as a dark code panel independent of page theme (code panels stay
  dark-on-dark-bg in both light and dark page themes — code blocks are a
  fixed visual register, not themed content), with a comment-color token
  distinct from keyword/string tokens.
- One card per source/component being compared, in a simple vertical stack
  or grid — not prose describing the code.

## Footer

One or two lines: exact versions/tags verified, and the upstream issue
number or reference if one exists. No attribution boilerplate.

## Process notes

- Verify claims against what's actually installed (`--version`, package
  manager, `dpkg -L`, man pages) rather than trusting memory of a library's
  behavior — this kind of writeup exists because the obvious explanation was
  wrong.
- When iterating with the user on an already-published page, treat each
  request ("simplify the structure," "keep the source code," "keep
  anchors") as a targeted edit to the existing file, not a rewrite — preserve
  what wasn't mentioned.

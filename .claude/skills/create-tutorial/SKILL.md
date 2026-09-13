---
name: create-tutorial
description: Use when adding a tutorial to the CloudCodeTree Tutorials section — a new part in an existing learning series or a brand-new series. Triggers include "create/add a tutorial", authoring files under app/tutorials/(article)/, scaffolding a tutorial companion repo, or running /new-tutorial.
---

# Creating a tutorial

Tutorials are hand-authored **MDX** at `app/tutorials/(article)/<slug>/page.draft.mdx`, indexed in
`app/tutorials/manifest.ts`, grouped into **series** and shown with a branded hero cover.
Separate from the auto-generated AI News blog.

**Scaffold the stub mechanically, then author the content yourself.** The scaffolder gets
every mechanical detail right (composed title, OG image, `<TutorialHero>`, manifest entry,
sibling "Part k of M" bumps, cover). You write the prose and — for verified tutorials — the
tested code. Never hand-create the manifest entry or MDX boilerplate.

## Two types — pick first, it changes everything

- **verified** (default) — locally runnable code with a step-tagged companion repo
  (`tutorial-<slug>`). **Every code block and every result shown MUST come from a real run.**
- **anchored** — GPU/version-sensitive topics you can't run locally (fine-tuning, serving).
  No companion repo, **no "tested locally" claims**; teach the concept and link an official notebook.

## The one command

```bash
node scripts/scaffold-tutorial.mjs <slug> --series "Series Name" --title "Subtitle" \
     --type verified|anchored [--excerpt "…"] [--tags "Tutorial,RAG,Python"] \
     [--read 10] [--with-repo]
```
It appends a `draft: true` manifest entry (as the series' next part), bumps siblings'
"(Part k of M)", writes `page.draft.mdx` from a type-aware template full of `TODO`
markers, and regenerates covers. Drafts can be committed and pushed without creating
a production route. `pnpm run build:staging && pnpm run deploy:staging` publishes
all tutorial drafts to the noindex beta preview with a visible preview banner.
For verified tutorials, `--with-repo` also scaffolds the local companion repo
(then `node scripts/new-tutorial-repo.mjs <slug> --create-remote` to publish it). Run
`--help`-style by reading the script header for all flags. It never commits.

## Hard rules (the judgment the script can't do)

- **Verified: real output only.** Probe the corpus/query until the teaching example actually
  reproduces; test it in a venv; paste the *actual* output. If a claim doesn't reproduce, fix
  the example — never fabricate. Tag each step (`step-01`, …) in the companion repo.
- **Anchored: verify links are live** before linking (open them), keep the GPU `<Callout tone="warn">`,
  and make code snippets clearly illustrative.
- **MDX gotcha:** a bare `<` before a digit/space in prose (e.g. `<1%`) parses as JSX and fails
  the build — write "under 1%" or `&lt;1%`. (Inside fenced code it's fine.)
- **No personal info — scrub before publishing.** Tutorials are public. The "real output" rule
  makes this easy to violate, because real runs leak identifying data into pasted commands and
  output. Replace all of it with generic placeholders: hostnames/MagicDNS names (`my-mac`),
  Tailscale/IP addresses (`100.x.y.z`), usernames and `/Users/<name>/...` paths (`~/...` or `you`),
  account handles/emails (`you@`), device names, API keys/tokens, and **real private project or
  repo names** (`web-app`, `api-server`). Keep generic hardware/OS facts (e.g. "a Mac mini (M1)").
  Sweep with a grep for your name/handles/IPs before commit.
- **Fill every `TODO`** the template leaves (TL;DR, intro, sections, sources).

## After authoring

1. `pnpm build` — must compile and export; confirm the draft URL remains absent.
2. Mobile check: no horizontal page overflow at 320px (code blocks scroll inside `<pre>` — that's fine).
3. Personal-info sweep: grep the page for your name, handles, real hostnames/IPs, and private project names; confirm it comes back clean (see the "No personal info" hard rule).
4. Commit + push the draft. If the push is rejected, the autonomous blog pipeline pushed first — `git fetch && git rebase origin/main`, then push.

## Releasing is a separate action

Do not publish merely because authoring is complete. After explicit release direction,
remove the lesson's `draft: true`. For a new course, also add its exact series name to
`RELEASED_TUTORIAL_SERIES`. Both gates live in `app/tutorials/manifest.ts`. Build and
verify the live URL, feed, topic pages, and sitemap before calling the release complete.

## Conventions (reference)

- Display title is composed by `fullTitle()` as `Series: Subtitle (Part N of M)` — used for
  `<title>`/Open Graph; the UI shows a `Series · Part N/M` eyebrow + the subtitle. The scaffolder bakes it in.
- The manifest is the **single source of truth**: `scripts/generate-tutorial-covers.mjs` and the
  scaffolder both read it via `scripts/lib/tutorials-data.mjs`. Covers are committed (small fixed set).
- `app/tutorials/page.tsx` sorts by `order`, so manifest insertion position doesn't matter.
- Companion repo build is a **git-tag-per-step** progression (`main` = finished); README has a
  step compare-table. Scaffold with `scripts/new-tutorial-repo.mjs`.

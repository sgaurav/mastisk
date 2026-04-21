# Unverified / low-confidence items

Things that shipped but weren't exercised end-to-end. Worth browser-testing
next time we pull a chair up to the daemon. Grouped by confidence.

Last updated: 2026-04-21 after the digest-stub / open-questions / SW-auto-reload
fix pass.

## Verified in browser (2026-04-21)

- Open Questions sidebar click → `/open-questions` view renders 37 questions
  grouped by article. (Root cause of earlier failure: stale Service Worker
  cache serving an old bundle with no `open_questions` in `SYS_VIEWS`.)
- Daily digest counters after stub filter: "Pages touched" dropped 66 → 4
  (dropping 62 stubs); threads no longer contain "MCP / Simon Willison /
  Claude API" placeholder entries.
- Wiki link hover card pops on `.link[data-target]` mouseover, fetches
  `/api/articles/:id/preview`, renders Kind + title + summary.

## Medium confidence — API-verified, UI not clicked through

- **Synthesizer** — live feed shows "synthesized" ticks at 8m and 17m, so the
  agent DID fire and produce output. Quality of the synthesis, the
  Keep/Discard feedback strip on a Synthesis article, and the self-refine
  critic loop have not been visually inspected. The two visible outputs
  ("Agent UX Inversion", "The Interface is the Agent") have been ingested
  into the wiki but the user's reaction (keep vs discard) was never driven
  through the UI.
- **Artifact generation** — `/api/articles/:id/artifacts/regenerate`
  enqueues a job; kimi-k2.6:cloud has produced valid specs in prior
  sessions. Never clicked "Regenerate" and watched the ArtifactPanel
  render a chart. Chart.js canvas destroy-on-unmount is untested.
- **Artifact edit/delete** — modal ships; PATCH/DELETE routes exist; the
  round-trip from ⚙ click → edit dialog → save → re-render was never
  exercised.
- **Settings page save** — GET/POST routes work from curl, form submission
  from the UI unverified.
- **Digest prev/next nav** — arrows render from `prev_date`/`next_date`,
  backend filter now skips stub-only days; not yet clicked.
- **Compiler known-articles registry** — the top-80-by-recency block is
  injected into prompts; effect on NEW source compilations (does Claude
  actually reuse the slugs?) not measured. Would need a fresh scout
  fetch + diff of picked slugs.

## Low confidence — silent-failure risk

- **SW auto-reload on next deploy** — `main.tsx` now listens for
  `controllerchange` and reloads. This only kicks in for users who have
  ALREADY loaded a bundle containing the listener. First-time rollout
  still requires a manual refresh. Need to ship a second deploy to
  actually verify the auto-reload fires.
- **Graph view** — renders, but interactive hover/click navigation,
  zoom, node dragging — none tested.
- **Search dialog (⌘K)** — keyboard opens the Ask drawer; unclear if
  fuzzy-search over titles works or just routes to "Ask".
- **Ask drawer** — sends to `/api/ask`, expects Claude response. Claude
  CLI PATH is known-working but the actual Q&A round-trip wasn't driven.
- **Linter dedup across ticks** — on the first tick we saw advise/flag
  rows emitted; idempotency on tick #2 not confirmed. Risk: advise feed
  polluted by duplicate lints.
- **Queue page with real jobs** — grid layout fixed for compiler rows,
  but behavior with a mixed-verb queue (queued + transcribing + running)
  untested.
- **Open Questions click-through** — clicking a question card → article
  view, untested.
- **Mobile PWA** — manifest + icons shipped, tailnet URL documented.
  Never installed on a phone; unknown if `iOS` Home-Screen add renders
  correctly.

## Dormant — not wired up yet

- **Listener agent** — stub in codebase, not scheduled.
- **Cost cap / budget enforcement** — config has limits, no enforcement
  code reads them yet. Ollama cloud spending is unmonitored.
- **Ollama-down failover** — when Ollama is down the bridge fails open
  silently; no UI signal to the user.

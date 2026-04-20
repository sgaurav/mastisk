# Chat

_Started 2026-04-20 10:50 UTC_

---

## User

Create an end-to-end design for a knowledge wiki based on karpati's knowledge wiki idea. There are 24/7 agents who do research, read blogs, watch podcasts, and watch YouTube videos and keep on producing artefacts that I should be reading a summary of. It should build all the connections so I can read in depth about anything, click on any text and ask questions related to it, or expand more things around it. It should be very extensible but also very clear in design. It should be desktop first and it should also have some connection or a way to access it on mobile as well, maybe a mobile app to consume things quickly. It can be a web version which can be embedded as a PWA on mobile.

Search the internet and find more on how people are building a second brain custom ghost reader, you can say, and the things which I have already mentioned but in detail, all the edge cases and everything. Pick a modern design language. It should support both light mode and dark mode.

## Assistant

I'll research this thoroughly and design a thoughtful knowledge wiki for you. Let me gather context first.

_[tool: snip]_

_[tool: update_todos]_

_[tool: web_search]_

_[tool: web_search]_

I have excellent context now. Let me snip the huge research block and start designing. The user wants me to proceed (didn't ask questions). I'll build a complete desktop-first hi-fi prototype with light/dark modes, with mobile PWA also shown.I have a clear picture. Let me build this as a single, cohesive desktop-first prototype with a mobile companion view, light/dark, and tweaks.

**Design language:** Editorial-meets-IDE. Inspired by Linear/Are.na/Reader. Serif for reading body (Source Serif 4), grotesk UI (Inter Tight), mono for metadata (JetBrains Mono). Warm-neutral light mode, deep cool-neutral dark mode. Single accent: a saturated amber-orange that reads well on both. Knowledge nodes are typed (Concept · Entity · Source · Synthesis) with subtle pictographic glyphs, not emoji.

Let me build the file structure.

_[tool: write_file]_

_[tool: copy_starter_component]_

_[tool: snip]_

_[tool: copy_starter_component]_

_[tool: snip]_

Now let me build the main shell. I'll create separate JSX component files to keep things modular.

_[tool: write_file]_

_[tool: snip]_

_[tool: write_file]_

_[tool: snip]_

_[tool: write_file]_

_[tool: snip]_

_[tool: write_file]_

## Assistant

## Assistant

_[tool: snip]_

_[tool: write_file]_

_[tool: write_file]_

_[tool: snip]_

_[tool: snip]_

_[tool: write_file]_

_[tool: snip]_

_[tool: done]_

_[tool: snip]_

_[tool: fork_verifier_agent]_

**Mastisk** — a personal knowledge wiki built around 24/7 research agents.

**Design language:** Editorial-meets-IDE. Source Serif 4 for reading, Inter Tight for UI, JetBrains Mono for metadata. Warm paper light mode / deep cool ink dark mode, with a single amber accent tunable via Tweaks.

**What's in there:**
- **Desktop shell** — three-pane: typed vault sidebar (Concepts · Entities · Sources · Synthesis), article reader, right rail with concept map, related, backlinks, and live agent feed.
- **Article page** — kind glyph, confidence bar, dashed-underline wikilinks, select-any-text popover for Ask / Expand / Link, sources block.
- **Daily Digest** — "what your agents read while you slept," counters, narrative threads, in-progress queue.
- **Agents view** — five specialists (Scout, Listener, Compiler, Linter, Synthesizer) with live load.
- **Graph view** — clustered by kind, click to navigate.
- **Ask drawer** — opens from selection with context chip, cited answers, follow-up suggestions.
- **Mobile PWA** — three iPhone frames: swipe-card digest, dark reader with selection popover, Ask with voice-ready input.
- **Tweaks** — accent (5 hues), serif family, density. Light/dark toggle in titlebar.

Toggle Tweaks from the toolbar to try accents + fonts; theme toggle is top-right.


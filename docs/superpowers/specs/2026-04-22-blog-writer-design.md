# Blog Writer — Design Spec

**Status:** Draft (autonomous, pending user review)
**Author:** Mastisk team (brainstormed with Claude Opus 4.7)
**Date:** 2026-04-22
**Scope:** Fourth compounding subsystem. Notes + Roundtable + GitHub are shipped or in plan; Blog Writer sits on top of them, converting accumulated synthesis into first-person drafts.

---

## 1. Context & Goals

Mastisk's pipeline now produces a lot of first-class material — classified notes, roundtable syntheses, compiled articles, GitHub idea-notes. What's missing is a way to pull a 14-day slice of that material into a single long-form draft the user can edit and ship.

**Purpose (one line):** On-demand async job that drafts a blog post in the user's voice from recent synthesis in the wiki, with inline citations back to every source it used.

**Goals:**
1. User hits a button (or CLI), optionally names a theme, and gets back a 800–2000 word markdown draft within ~60–120s.
2. The draft reads in the user's first-person voice (sourced from `_self/identity.md` + `style.md`), not a classifier's prose.
3. Every non-trivial claim in the draft links back to a concrete source item (note / article / roundtable / repo idea). Citations are clickable in the PWA and resolve to the source's view.
4. The draft is a real markdown file in the vault so Obsidian / any editor can open and edit it. YAML frontmatter captures provenance.
5. Compounding: a finished draft can become a note via the existing Notes capture path (`save-as-note`), which means the blog itself becomes retrievable substrate for future drafts/roundtables/research.

**Success criteria:**
- User clicks "Draft a post" in the sidebar → gets a modal (optional theme + window slider) → 202 pending → 60–120s later, a drafted markdown file at `vault/blog/drafts/<slug>.md`, listed at `/blog` and opened at `/blog/:id`.
- Clicking an inline citation in the rendered draft navigates to the source note/article/roundtable.
- Zero sources in the window → clear 422 error, no half-state.
- Claude unavailable → Ollama fallback produces a weaker but valid draft with the same citation shape.

---

## 2. Non-Goals (v1)

- **No scheduled / automatic drafting.** v1 is on-demand only. No "draft me a post every Sunday" cron.
- **No source-type filters in the modal.** All four types (notes, articles, roundtables, repo idea-notes) feed in by default. Theme-relevance ranking is the only lever.
- **No multi-LLM consensus for the draft itself.** Roundtable already handles that for source material; the blog writer drafts from material that's *already* been through a roundtable. One Claude call (Ollama fallback).
- **No in-app rich-text editor.** Output is markdown-in-a-file; the user edits in Obsidian / VS Code / the vault.
- **No image generation / hero images.** A future pass can pick a hero from cited articles' `hero_image_url`; out of v1.
- **No multi-variant drafts** ("give me three versions"). Regenerate replaces.
- **No publishing integrations** (Medium / Substack / Ghost / custom RSS). Draft only.
- **No style transfer between drafts** or "blog-specific voice training." Voice comes from the existing `_self/style.md`.
- **No streaming tokens to the UI.** Poll-based progress. Matches the Roundtable pattern.
- **No authorship attribution beyond frontmatter.** The vault file is the artifact.

---

## 3. Architecture

```
User trigger                    Orchestrator                      Source pool                         Output
────────────                    ────────────                      ───────────                         ──────
Sidebar "+ Draft post" ──┐                                        ┌─ notes (non-deleted,        ┌───────────────────────────┐
/blog + modal            ├── POST /api/blog-posts ──enqueue──►┌──►│  classified, window)       ┌► vault/blog/drafts/<slug>.md │
CLI `mastisk blog`       ┘                                    │   │                            │  + YAML frontmatter         │
                                                              │   ├─ articles (updated_at in    │                           │
                                                      ┌───────▼───┐  window)                    │                           │
                                                      │ blog_writer│                            │                           │
                                                      │ agent     │◄──rank by recency or theme──┤                           │
                                                      │  _handle  │                            │                           │
                                                      └────┬───┬──┘                            │                           │
                                                           │   │   ├─ roundtables (status=done, │                           │
                                                           │   │   │   finished_at in window)   │                           │
                                                           │   │   └─ repo_idea_runs            │                           │
                                                           │   │       (ideated_at in window)   │                           │
                                                           │   │                                │                           │
                                                           │   └──► claude_bridge.run_claude ──►│                           │
                                                           │       prompt: identity + task +   │                           │
                                                           │       sources + output contract   │                           │
                                                           │       (single inlined string)     │                           │
                                                           │                                    │                           │
                                                           ▼                                    ▼                           │
                                                  DB: blog_posts                          file on disk                      │
                                                    + blog_post_sources                   (via atomic_write)                │
                                                    + emit_feed('blog-done')                                                │
                                                                                                                            │
                                                           ┌────────────────────────────────────────────────────────────────┘
                                                           ▼
                                                   PWA BlogView (poll → render → citation links)
                                                   + "Save as note" → feeds Notes pipeline
                                                   + "Regenerate" → new run, same blog_post_id
```

**Storage model (hybrid, same as Notes):** the markdown file in `vault/blog/drafts/` is the source of truth for the body. SQLite `blog_posts` row is the index (title, dates, status, path). `blog_post_sources` is the citation ledger — one row per (blog_post_id, source item) so we can render clickable citations and backlink the other way ("drafts that cited this note").

**Agent pattern:** new `BlogWriter` agent subclassing `Agent`. One blog post per job. `enqueue("blog_writer", "draft", {"blog_post_id": id})`. Base class `run_once` picks one job per tick — serial, matches Roundtable/Escalator. Tick interval short (~10s) because drafts are user-triggered and latency-visible.

---

## 4. Components

| kind | path | new? | purpose |
|---|---|---|---|
| API route | `src/mastisk/routes/blog_route.py` | new | POST create (202), GET list, GET detail, POST save-as-note, POST regenerate, DELETE soft-delete |
| Agent | `src/mastisk/agents/blog_writer.py` | new | Source selection + ranking, prompt assembly, Claude call, parse, write file, persist sources |
| DB schema | `src/mastisk/db/schema.sql` | edit | `blog_posts` + `blog_post_sources` tables with indexes |
| Queries | `src/mastisk/db/queries.py` | edit | `create_blog_post`, `get_blog_post`, `list_blog_posts`, `update_blog_post_status`, `insert_blog_post_source`, `list_blog_post_sources`, `soft_delete_blog_post` |
| CLI | `src/mastisk/cli.py` | edit | `mastisk blog [THEME]` (no arg → $EDITOR), `mastisk list-blogs` |
| Settings | `src/mastisk/settings.py` | edit | `BlogSettings` nested under `Settings.blog` |
| Paths | `src/mastisk/paths.py` | edit | `blog_dir()` and `blog_drafts_dir()` helpers; `ensure_dirs()` creates them |
| Scheduler | `src/mastisk/scheduler.py` | edit | Register `BlogWriter` agent (10s tick, matches Roundtable); extend boot-time `_reclaim_orphaned_running` to also sweep stale `blog_posts WHERE status='running'` (see §13) |
| Frontend | `frontend/src/components/BlogView.tsx`, `BlogListView.tsx`, `BlogDraftModal.tsx` | new | Detail view with citation rendering, list view, modal for trigger |
| Frontend | `frontend/src/components/Sidebar.tsx` | edit | Sidebar entry "Blog" with `+` button (mirror Notes/Repos pattern) |
| Frontend | `frontend/src/App.tsx`, `types.ts`, `router.ts`, `api.ts` | edit | Wire views, types, `/blog` + `/blog/:id` routes, API client |

---

## 5. User Flow

1. **Trigger.** User clicks the `+` button next to "Blog" in the sidebar → `BlogDraftModal` opens. Two controls: free-text theme input (optional) + window slider (7/14/30/90 days, default 14). Big "Draft" button. (CLI equivalent: `mastisk blog "test-time compute"` or `mastisk blog` with $EDITOR for the theme.)
2. **POST /api/blog-posts.** Body: `{"theme": "...", "window_days": 14}`. Server inserts a `blog_posts` row (`status='pending'`, `theme`, `window_days`, `created_at`), enqueues `jobs(agent='blog_writer', kind='draft', payload_json='{"blog_post_id": N}')`, returns 202 with `{id, status}`. Route navigates the user to `/blog/:id`.
3. **Pending.** BlogView polls `GET /api/blog-posts/:id` every 2s. Renders "Drafting… this usually takes 60–120s." Status chip shows `pending → running`.
4. **BlogWriter agent picks up the job** (next tick, ≤10s later). Transitions `status='running'`. See §7 for the detailed flow.
5. **Done.** Agent writes the file, inserts `blog_post_sources` rows, flips `status='done'`, `finished_at=now`, emits `feed(verb='blog-done')`. Poller stops, BlogView re-fetches once more and renders the draft with clickable citations.
6. **Actions in BlogView.**
   - **Open in editor.** Button reveals the draft's on-disk location; click copies the absolute path to clipboard (Obsidian/any-editor accepts that). The API returns `path` (relative to the vault); the frontend combines it with `vault_dir()` (exposed via the existing `/api/info` endpoint or equivalent) before copying.
   - **Regenerate.** POST `/api/blog-posts/:id/regenerate` → server resets the row to `status='pending'`, enqueues a new job, polls resume. Old draft is overwritten (the file is the source of truth; no draft history in v1). See §7 for semantics.
   - **Save as note.** POST `/api/blog-posts/:id/save-as-note` → uses the same Phase 1 capture helpers as the Roundtable route. 409 if the blog post isn't `done` yet. Idempotent (returns existing note_id on second call).
   - **Delete.** DELETE `/api/blog-posts/:id` → sets `deleted_at` and unlinks the vault file. Tombstones `blog_post_sources` via CASCADE.
7. **Failure.** `status='failed'` with `error` set. BlogView shows the error + a "Regenerate" button. No half-written file in the vault (we write atomically at the end of the agent run).

---

## 6. Data Flow — Source Selection + Ranking

This is the most algorithmically load-bearing part of the spec. Be explicit.

### 6.1 Candidate pool (the `window_days` slice)

Compute `cutoff = now - window_days`. Pull three queries (one per source type), all excluding soft-deleted rows. Repo-idea-authored notes are already covered by the notes query — we do NOT run a separate fourth query against `repo_idea_runs` (that would double-count the same notes). Instead we run a small auxiliary query that returns just the ids of notes authored by the ideator in-window, load that set into memory, and tag matching candidates with `origin='repo_ideator'`.

```sql
-- notes: classified and in-window
SELECT 'note' AS kind, id AS ref, slug, created_at AS ts, summary, body, classification, tags_json
  FROM notes
 WHERE deleted_at IS NULL
   AND classified_at IS NOT NULL
   AND (classified_at >= :cutoff OR created_at >= :cutoff)
 ORDER BY created_at DESC;

-- articles: updated in-window (external-content + escalator stubs both land here)
SELECT 'article' AS kind, id AS ref, slug, updated_at AS ts, summary, body_md
  FROM articles
 WHERE updated_at >= :cutoff;

-- roundtables: finished in-window with a synthesis
SELECT 'roundtable' AS kind, id AS ref, NULL AS slug, finished_at AS ts,
       substr(synthesis, 1, 240) AS summary, synthesis AS body, prompt
  FROM roundtables
 WHERE status = 'done'
   AND synthesis IS NOT NULL
   AND finished_at >= :cutoff;

-- auxiliary: ids of notes that were written by the GithubIdeator in-window.
-- Not a candidate source on its own; used to tag notes from the notes query
-- with origin='repo_ideator'. The blog-writer doesn't need a separate
-- "repo idea" notion — an ideator-authored note is already a note; we just
-- tag its origin so Claude (and the ranker) know it came from repo context.
SELECT DISTINCT value AS note_id
  FROM repo_idea_runs, json_each(repo_idea_runs.note_ids_json)
 WHERE repo_idea_runs.ideated_at >= :cutoff
   AND json_valid(repo_idea_runs.note_ids_json);
```

Load the auxiliary set into a Python `set[int]`. After the notes query resolves, stamp each note candidate with `origin='repo_ideator'` iff its `id` is in the set. All other candidates (articles, roundtables, non-ideator notes) get `origin=None`.

### 6.2 Ranking

Two modes:

**Mode A — No theme (rank by recency).** Sort the full candidate pool by `ts DESC`. Take top `max_sources` (default 40). Done.

**Mode B — Theme given (rank by theme relevance, then recency).**

v1 uses **keyword overlap + LLM ranking**, no embeddings (we don't have blog-specific embedding infra and `article_embeddings` only covers articles, not notes/roundtables).

1. **Cheap keyword pass.** Tokenize the theme into a set of lowercased non-stopword terms (simple regex split `[a-z0-9]+` after lowercasing + a small stoplist). For each candidate, compute `score = overlap_with_summary + 0.5 * overlap_with_body_first_1000_chars`. Keep top `pre_rank_limit` (default 80).

   **Stoplist.** A Python `frozenset[str]` defined at module level in `src/mastisk/agents/blog_writer.py` (~50 common English words):

   ```python
   STOP_WORDS: frozenset[str] = frozenset({
       "the", "a", "an", "is", "are", "was", "were", "and", "or", "but",
       "in", "on", "at", "to", "for", "of", "with", "from", "by", "as",
       "this", "that", "it", "its", "they", "them", "their", "we", "you",
       "your", "i", "me", "my", "he", "she", "his", "her", "have", "has",
       "had", "do", "does", "did", "be", "been", "being", "will", "would",
       "could", "should", "can",
   })
   ```

   English-only for v1. If the user's themes start drifting multilingual (a concrete signal: ranker quality complaints), swap for a language-aware tokenizer later.
2. **LLM rerank (single Ollama call, cheap model).** Feed the theme + a numbered list of `(kind, summary, first 200 chars of body)` to Ollama (`blog.ollama_model`, default `llama3.1:8b` — same setting used for the draft-time Ollama fallback in §13). Concrete prompt template:

   ```
   You are ranking knowledge-base sources by relevance to a theme. Return STRICT JSON only.

   Theme: {theme}

   Sources (0-indexed):
   0. [note] {title_or_preview_1}
   1. [article] {title_or_preview_2}
   2. [roundtable] {title_or_preview_3}
   ...

   Return JSON matching this schema exactly:
   {"relevant": [<int>, <int>, ...]}

   Where the list contains source indices in descending order of relevance to the theme.
   Exclude indices that are not relevant. Maximum 30 indices.
   Do not include any prose before or after the JSON.
   ```

   **Validation.** Parse the response as JSON. Require a top-level object with a `relevant` key whose value is a list. Every element must be an integer in the half-open range `[0, len(sources))`. On any validation failure (non-JSON, missing key, wrong type, out-of-range index, non-integer element), log with `log.warning` and fall back to the keyword-pass ordering for this run — do not attempt a retry. Keep the top `max_sources` (default 40) from the validated list. See §17 for why strict validation matters (theme text is user-controlled input to this prompt).

**Why not embeddings?** We don't have embeddings for notes or roundtables. Adding an embed step would mean calling Ollama `embed` for every candidate, re-implementing the cosine math, and cache-invalidating on edits. Keyword + LLM rerank is ~one Ollama call total vs. N, and good enough for a v1 with ~40 candidates. If the ranker becomes a quality bottleneck, upgrade to embeddings later (`note_embeddings` + `roundtable_embeddings` tables, mirror of `article_embeddings`).

### 6.3 Truncation

After ranking, `max_sources` (40) candidates × ~500 chars of summary = ~20k chars context. Within comfortable Claude prompt budget. Per-candidate truncation: `summary` (full) + `body/body_md/synthesis` truncated to 1500 chars (configurable via `BlogSettings.per_source_char_limit`).

If the total assembled prompt exceeds `BlogSettings.prompt_char_limit` (default 60,000), **iteratively halve `per_source_char_limit` with a floor of 300 chars before dropping any source**. Only drop tail items after per-source is at the 300-char floor and the total still exceeds the cap. The tail is the lowest-ranked end of the theme-ranked list, so dropping it loses least-relevant items — but dropping at all is a last resort because the theme-ranked order puts the most-relevant items first and the tail still carries signal.

`origin` is informational for v1 ranking — the ranker does not promote `repo_ideator` notes over other classified notes automatically. It's surfaced in the prompt metadata (`- origin: repo_ideator (...)` under the source heading) so Claude can weight it, and it's persisted on `blog_post_sources.origin` for later debugging.

### 6.4 Empty pool

If `len(candidates) == 0`:
- At the route layer (pre-enqueue): POST returns 422 `{"detail": "no sources in window — try widening window_days or capturing more notes first"}`.
- At the agent layer (race: user widened window mid-request): `status='failed'`, `error='no sources in window'`.

The route-layer check is a lightweight `COUNT` across the three candidate queries (notes, articles, roundtables). Doing it before enqueue keeps the error UX synchronous for the common case. The `repo_idea_runs` auxiliary doesn't need to be counted — it's a tagger, not a standalone source.

---

## 7. State Machine

```
                          ┌───────────────┐
                          │    pending    │  (row inserted by POST)
                          └───────┬───────┘
                                  │ BlogWriter picks up job
                                  ▼
                          ┌───────────────┐
                          │    running    │
                          └───┬───────┬───┘
          Claude + file write│       │ Claude + Ollama both failed
          complete           │       │ OR empty source pool
                             ▼       ▼
                      ┌──────────┐   ┌──────────┐
                      │   done   │   │  failed  │
                      └─────┬────┘   └────┬─────┘
                            │             │
             POST /regenerate│             │POST /regenerate
                            ▼             ▼
                          (back to pending; file path reused, row id same)
```

The DB column is `status TEXT CHECK status IN ('pending','running','done','failed')`. Soft-delete is **orthogonal to status** — it lives on the separate `deleted_at` column (nullable DATETIME). A row can be `done` AND soft-deleted at the same time; there is no `deleted` status value. The DELETE endpoint sets `deleted_at = CURRENT_TIMESTAMP` and unlinks the vault file but does NOT mutate `status`. Queries that list drafts filter on `deleted_at IS NULL`; the agent's in-loop race checks (§13) also guard on `deleted_at IS NOT NULL`.

**Regenerate semantics:** same `blog_post_id`, same vault path. The row is reset to `status='pending'`, `error=NULL`, `finished_at=NULL`. A new job is enqueued. The agent overwrites the file on success. `blog_post_sources` is CASCADE-deleted and repopulated. No history in v1 (matches the "file is source of truth" model — git / iCloud history is the user's versioning).

**Rule:** terminal statuses are `done` and `failed`. Regenerate is only legal from `done` or `failed` (not from `pending` / `running`, which would race the in-flight job — see §11 for the full precondition incl. jobs-queue check).

**Guard against double-processing:** `_handle` loads the row and skips if status isn't `pending` or `running`. Same pattern as `Roundtable._handle`.

---

## 8. Prompt Design

The entire prompt — identity, task, sources, and output contract — is assembled as a single string and passed to `claude_bridge.run_claude(prompt=<full text>)`. We do **not** use the bridge's `source_md=` / `schema_md=` companion-file parameters. Reasoning: `claude -p <prompt>` runs the prompt as the primary instruction; files in `--add-dir` are only read if Claude chooses to open them. Inlining everything removes that variability.

### 8.1 Ranked sources block (assembled into the prompt)

Rendered as part of the prompt string (not a separate file). One labeled section per ranked candidate:

```markdown
## Sources

### Source 1 — note #127 "Test-time compute: cost of one extra token"
- kind: idea (classification)
- captured: 2026-04-19
- tags: test-time-compute, inference-economics

One-sentence summary from the note classifier.

---

(First 1500 chars of note body, unmodified.)

### Source 2 — article "Agent memory" (slug: agent-memory)
- kind: Synthesis article
- updated: 2026-04-16

(summary)

---

(First 1500 chars of body_md.)

### Source 3 — roundtable #42 "How does chain-of-thought change test-time compute?"
- kind: roundtable synthesis
- finished: 2026-04-15
- synthesis_model: claude

(synthesis, truncated to 1500 chars — which is usually the whole thing since synthesis is ≤250 words)

### Source 4 — note #131 "From repo: anthropics/claude-code — streaming UX"
- kind: question (classification)
- captured: 2026-04-14
- origin: repo_ideator (anthropics/claude-code)

(summary + body as above)

...
```

The `### Source N —` heading is the **citation anchor**: the prompt instructs Claude to cite with the literal string `[source N]` inline, and we parse those back into `blog_post_sources` rows during post-processing.

### 8.2 Prompt template (single string — identity + task + sources + output contract)

```markdown
# Blog draft task

You are drafting a personal blog post in the author's voice from their recent notes, articles, roundtable syntheses, and repo-derived ideas.

Author identity and voice: {identity_preamble}

## Theme
{theme_or_none}

When a theme is provided, center the draft on it — weave the sources into a coherent argument about the theme. When no theme is provided, look at the sources, find the strongest recurring thread across them, and write about that.

{sources_block}

## Constraints
- 800–2000 words. Aim for 1200.
- First-person voice. Use "I" naturally; mirror the author's cadence from the identity/style guidance above.
- Lead with a concrete hook — a specific observation, not "In this post we will explore…".
- No section headers unless the argument genuinely needs them. Prose > bullets.
- No moralizing, no LinkedIn-voice, no corporate summary language.
- Cite specifically. Every non-trivial claim must end with `[source N]` pointing at the exact source that supports it. If two sources back the same claim, write `[source 2, source 5]`. Do not invent source numbers.
- End with one forward-looking question or open thread — something the author is still thinking about. Do not wrap with a pat conclusion.

## Output contract
Respond with a BARE JSON object — no markdown fences, no preamble, no reasoning trace. The object MUST match this shape exactly:

{
  "title": "Concrete noun-phrase title, ≤80 chars, in sentence case",
  "tags": ["2-5 lowercased-kebab tags"],
  "body_md": "The full draft as markdown. Newlines escaped as \\n. Inline citations use [source N]."
}

`body_md` MUST be a JSON string (properly escaped newlines); do NOT wrap it in ``` fences. Do not emit anything before or after the JSON object.
```

**`{identity_preamble}` transform.** `Agent.load_identity()` in `src/mastisk/agents/base.py` (lines 72–83) returns a string starting with `# About the user\n` and concatenates identity/interests/dislikes/style/learnings. Embedding that raw would nest its `# About the user` H1 inside our document and confuse the model's header tree. Before interpolation we strip that leading header:

```python
raw_identity = Agent.load_identity()  # starts with "# About the user\n..."
identity_preamble = raw_identity.removeprefix("# About the user\n").strip()
```

The preamble is then inserted inline (not under a header of its own) as a paragraph introducing the author's voice. `{sources_block}` is the full `## Sources` section from §8.1, already rendered as a Markdown string.

### 8.3 Output contract (summary)

The output-contract language lives inline in the prompt (see §8.2). There is no separate `SCHEMA.md` file. Claude returns a bare JSON object with `{title, tags, body_md}`.

### 8.4 Post-processing

1. `result = await claude_bridge.run_claude(prompt, timeout_s=blog.claude_timeout_seconds)`.
2. Parse the response body directly — do **not** use `extract_json_block`, which keys off ``` fences. `body_md` may contain fenced code blocks; an inner ``` would break `extract_json_block`'s regex-free split. Instead:
   ```python
   try:
       draft_json = json.loads(result["text"].strip())
   except json.JSONDecodeError as e:
       log.warning("blog_writer: non-JSON response: %s", e)
       draft_json = None  # caller falls through to Ollama
   ```
3. Parse `body_md` for `[source N]` occurrences. The bracket can hold one or more comma-separated integers, so we match the full list and split:
   ```python
   import re
   CITATION_RE = re.compile(r'\[source\s+([\d,\s]+)\]')
   cited_ns: set[int] = set()
   for m in CITATION_RE.finditer(body_md):
       for n in m.group(1).split(','):
           n = n.strip()
           if n.isdigit():
               cited_ns.add(int(n))
   ```
   Any N outside `1..len(candidates)` is stripped from the body (replace the whole `[source ...]` bracket with the empty string via a second `re.sub`) and logged with `log.warning`.
4. For each cited N, insert `blog_post_sources(blog_post_id, kind, ref, rank=N, used=1)`. For candidates that didn't get cited, insert with `used=0` so we keep the full provenance record of what was *offered* (useful for debugging "why did Claude ignore note X?").
5. Leave `[source N]` literal in the on-disk body (Obsidian-readable); the PWA resolver (see §11) turns them into clickable `<a>` tags at render time. This keeps the vault file portable.
6. Assemble frontmatter (see §9.2), atomic-write the file, update the DB row.

---

## 9. File Conventions

### 9.1 Layout

```
vault/
  blog/
    drafts/
      <YYYY-MM-DD>-<slug>.md
```

No `published/` folder in v1 — we don't have a publish step. If/when we add one, promotion moves the file.

**Filename:** `<YYYY-MM-DD>-<slug>.md` where:
- `<YYYY-MM-DD>` is the creation date of the blog post row (local TZ).
- `<slug>` is `slugify(title)` truncated to 60 chars, falling back to `draft-<blog_post_id>` if the title slugifies to empty.

On slug collision (user creates two drafts on the same day with similar titles), append `-2`, `-3` up to `-99` then loudly log. Same pattern as notes.

### 9.2 Frontmatter

Written by the agent. User can edit the body below it freely; regenerate will rewrite frontmatter + body both.

```yaml
---
blog_post_id: 17
title: "The cost of one extra token at test time"
created_at: 2026-04-22T11:04:02-07:00
updated_at: 2026-04-22T11:05:38-07:00
theme: "test-time compute"              # empty string if no theme was given
window_days: 14
status: done                             # mirrors the DB row (for Obsidian's benefit)
tags: [test-time-compute, inference-economics, ai-research]
sources:                                 # machine-readable citation map; used=true means cited in body
  - { n: 1, kind: note,       ref: 127,                   slug: "143012-test-time-compute", used: true }
  - { n: 2, kind: article,    ref: "agent-memory",        slug: "agent-memory",              used: true }
  - { n: 3, kind: roundtable, ref: 42,                    used: true }
  - { n: 4, kind: note,       ref: 131,                   slug: "140512-from-repo-claude-code", used: false }
model: claude                            # 'claude' or 'ollama'
word_count: 1284
---
```

The `sources:` list is the same data as `blog_post_sources` rows — both exist because the DB gives us fast query and the file gives us Obsidian portability.

---

## 10. Database Schema

Append to `src/mastisk/db/schema.sql`:

```sql
-- ─────────────────────────────── Blog posts ───────────────────────────────
-- User-triggered long-form drafts assembled from recent synthesis.
-- File in vault/blog/drafts/ is the source of truth for body_md; this row is
-- a derived index. See docs/superpowers/specs/2026-04-22-blog-writer-design.md

CREATE TABLE IF NOT EXISTS blog_posts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT UNIQUE NOT NULL,          -- filename without .md ('2026-04-22-the-cost-of-...')
  path            TEXT UNIQUE NOT NULL,          -- relative to vault root, e.g. 'blog/drafts/2026-04-22-...md'
  title           TEXT,                          -- null until status='done'
  theme           TEXT NOT NULL DEFAULT '',      -- '' when no theme was given
  window_days     INTEGER NOT NULL,              -- 7 | 14 | 30 | 90
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  model           TEXT,                          -- 'claude' | 'ollama' — populated at done
  tags_json       TEXT DEFAULT '[]',             -- JSON array of tags from Claude's output
  word_count      INTEGER,                       -- populated at done (len(body_md.split()))
  body_preview    TEXT,                          -- first 400 chars of the draft, for list views
  error           TEXT,                          -- populated iff status='failed'
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at     DATETIME,
  saved_as_note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
  deleted_at      DATETIME                       -- tombstone; file also unlinked
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_created ON blog_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status  ON blog_posts(status)
  WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_blog_posts_not_deleted ON blog_posts(id) WHERE deleted_at IS NULL;

-- Citation ledger: one row per (blog_post, source item) considered by the agent.
-- used=1 means cited in the draft; used=0 means offered but Claude didn't pick it.
-- Keeping used=0 rows lets us debug ranking + train better selection later.
CREATE TABLE IF NOT EXISTS blog_post_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_post_id  INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,                   -- 'note' | 'article' | 'roundtable'
  ref           TEXT NOT NULL,                   -- stringified (note_id | article_id | roundtable_id)
  rank          INTEGER NOT NULL,                -- N in `[source N]` — 1-indexed, matches the Sources block in the prompt (§8.1)
  used          INTEGER NOT NULL DEFAULT 0,      -- 1 if cited in body, 0 if offered-but-unused
  origin        TEXT                             -- 'repo_ideator' if the note came from GithubIdeator; else null
);

CREATE INDEX IF NOT EXISTS idx_blog_post_sources_post ON blog_post_sources(blog_post_id);
CREATE INDEX IF NOT EXISTS idx_blog_post_sources_ref ON blog_post_sources(kind, ref);
```

**Why `ref` is TEXT:** `article_id` is TEXT; `note_id` and `roundtable_id` are INTEGER. Stringifying unifies the lookup and lets us filter `blog_post_sources WHERE kind='note' AND ref='127'` regardless of the target's own type.

**No post-init ALTER needed.** Fresh columns on a fresh table only.

---

## 11. API Surface

```
POST   /api/blog-posts
       body: {"theme": "optional free text", "window_days": 14}
       validation:
         - window_days ∈ {7, 14, 30, 90}
         - theme length ≤ 500 chars (optional; empty string treated as "no theme")
         - pre-check: candidate pool is non-empty → 422 "no sources in window" if empty
       → 202, {"id": N, "status": "pending"}

GET    /api/blog-posts?limit=50&before=<blog_post_id>
       → 200, [{id, title, theme, window_days, status, created_at, finished_at,
                body_preview, word_count, model, saved_as_note_id}, ...]
       Excludes deleted_at IS NOT NULL rows.

GET    /api/blog-posts/:id
       → 200, {id, slug, path, title, theme, window_days, status, model, tags,
               word_count, body_md, error, created_at, finished_at,
               saved_as_note_id, sources: [{n, kind, ref, used, origin,
                                            resolved: {title|summary|...,
                                                       deleted: bool}}]}
       `body_md` is read lazily from the vault file. If the file is missing
       (iCloud unsubscribed, user moved/deleted it out of band), response is
       still 200 with `body_md: null` and `error: "file missing"`. The row is
       still browsable; the list-view `body_preview` is NOT substituted for
       `body_md` — that field stays strictly a list-view column.
       The `resolved` field on each source is the backend resolving the ref
       into a human-readable shell — the frontend uses it to render citation
       tooltips without a second round-trip. Deleted-source handling: if a
       cited note was deleted later, `resolved.deleted = true` and
       `resolved.title = "(note deleted)"` (or "(article deleted)", etc.);
       the citation renders without a link. See §14.4.

POST   /api/blog-posts/:id/regenerate
       body: {}   -- no body; uses stored theme + window_days
       Preconditions:
         - status ∈ {done, failed}; otherwise 409.
         - no in-flight job: reject with 409 if any row exists in `jobs`
           with agent='blog_writer' AND status IN ('queued','running')
           AND payload_json LIKE '%"blog_post_id": :id%' (parameterize).
           This prevents cascade-deleting sources while an earlier run is
           mid-flight (e.g. a prior job still sitting in the queue, or a
           running job whose row status hasn't flipped yet).
       → 202, {"id": N, "status": "pending"}

POST   /api/blog-posts/:id/save-as-note
       body: {}
       → 201, {"note_id": M, "slug": "...", "reused": false}
       Idempotent — second call returns the existing note_id with reused=true.
       409 if status != 'done'.
       Writes a note whose body is:
         > From blog draft #<id>: <title>
         (first 500 chars of body_md)
       …and inserts via the same notes_inbox/atomic_write path as Roundtable.

DELETE /api/blog-posts/:id
       → 204
       Sets deleted_at, unlinks the vault file (best-effort — log and continue
       if the file is already gone). CASCADE clears blog_post_sources.
```

**Citation rendering contract.** The backend returns `body_md` with literal `[source N]` tokens. The PWA's `BlogView` runs a render pass that:
1. Parses the same regex as the agent's post-processor (see §8.4).
2. Looks up the source in the response's `sources[]` by `n`.
3. If `sources[n].resolved.deleted === true`, renders the token as `<span class="citation-deleted">[N]</span>` with no href and a tooltip of "source deleted". Otherwise replaces the token with `<a href="/notes/{ref}"|/a/{ref}|/roundtables/{ref}" data-cite="N">[N]</a>`.
4. Hover/click navigates via the existing `onNavigate` prop (live citations only).

The `resolved.deleted` boolean on each source is populated by the backend when it resolves the ref: true if the underlying note/article/roundtable row has `deleted_at IS NOT NULL` (or for articles, is missing entirely) at read time. See §11.

---

## 12. Settings

Append to `src/mastisk/settings.py`:

```python
class BlogSettings(BaseSettings):
    """Config for the blog-writer subsystem.
    See docs/superpowers/specs/2026-04-22-blog-writer-design.md §12."""
    default_window_days: int = 14              # slider default in the modal
    allowed_window_days: list[int] = Field(default_factory=lambda: [7, 14, 30, 90])
    max_sources: int = 40                      # final cap after ranking
    pre_rank_limit: int = 80                   # keyword-pass cap before LLM rerank
    per_source_char_limit: int = 1500          # truncation per source body
    prompt_char_limit: int = 60000             # full assembled prompt cap (Claude path)
    ollama_prompt_char_limit: int = 20000      # stricter cap for llama3.1:8b fallback (see §13)
    target_word_count_min: int = 800
    target_word_count_max: int = 2000
    # No `blog_model` setting: `claude_bridge.run_claude()` doesn't accept a
    # model argument — it uses whatever `claude -p` is configured to pick
    # (the user's default model). Drafting and Ollama fallback share the
    # same `ollama_model` for the fallback path below.
    claude_timeout_seconds: int = 240          # drafts are long; be generous
    ollama_model: str = "llama3.1:8b"          # used for BOTH the theme rerank
                                               # (§6.2) and the Ollama draft
                                               # fallback (§13)
```

Nested under `Settings.blog` like `notes`, `roundtable`, `github`.

---

## 13. Agent Design

`src/mastisk/agents/blog_writer.py`:

```python
class BlogWriter(Agent):
    name: ClassVar[str] = "blog_writer"
    tick_seconds: ClassVar[int] = 10    # short tick — user-triggered, latency-visible

    async def _handle(self, job: dict) -> None:
        payload = json.loads(job["payload_json"] or "{}")
        bp_id = payload.get("blog_post_id")
        if bp_id is None:
            log.warning("blog_writer: no blog_post_id in job %s", job["id"])
            return

        with connect() as conn:
            bp = q.get_blog_post(conn, bp_id)
        if bp is None or bp.get("deleted_at") is not None:
            return
        if bp["status"] not in ("pending", "running"):
            return   # double-process guard

        with connect() as conn:
            q.update_blog_post_status(conn, bp_id=bp_id, status="running")

        try:
            # 1. Gather candidates.
            candidates = await self._gather_sources(bp["window_days"])
            if not candidates:
                raise RuntimeError("no sources in window")

            # 2. Rank (theme-aware or recency).
            ranked = await self._rank(candidates, theme=bp["theme"])
            ranked = ranked[: get_settings().blog.max_sources]

            # 3. Assemble the full prompt (identity + task + sources + schema
            #    — all inline; no companion files, see §8).
            prompt = self._render_prompt(theme=bp["theme"], ranked=ranked)

            # 4. Call Claude (Ollama fallback).
            draft_json, model_used = await self._call_llm(prompt)
            if draft_json is None:
                raise RuntimeError("LLM failed (both Claude and Ollama)")

            # 5. Parse citations + post-process.
            body_md, cited_ns = self._postprocess_citations(
                draft_json["body_md"], len(ranked),
            )

            # 6. Re-check deletion (race with DELETE /api/blog-posts/:id
            #    while we were drafting) before writing anything to disk or
            #    flipping status to done. See §7.
            with connect() as conn:
                fresh = q.get_blog_post(conn, bp_id)
            if fresh is None or fresh.get("deleted_at") is not None:
                log.info("blog_writer: %s deleted mid-draft, discarding", bp_id)
                # Nothing to write. Let the base wrapper mark the jobs row
                # done; the blog_posts row stays wherever DELETE put it.
                return

            # 7. Write file + persist.
            title = (draft_json.get("title") or "").strip()[:200]
            tags = draft_json.get("tags") or []
            slug = derive_blog_slug(title, bp_id, bp["created_at"])
            file_path = blog_drafts_dir() / f"{slug}.md"
            frontmatter = _build_frontmatter(bp_id, title, bp, tags, ranked, cited_ns, model_used, body_md)
            atomic_write(file_path, frontmatter + "\n" + body_md)

            # 8. One more deletion check post-write; if DELETE landed between
            #    step 6 and now, unlink the file and bail without marking done.
            with connect() as conn:
                fresh2 = q.get_blog_post(conn, bp_id)
            if fresh2 is None or fresh2.get("deleted_at") is not None:
                try:
                    file_path.unlink(missing_ok=True)
                except OSError:
                    log.warning("blog_writer: could not unlink orphaned %s", file_path)
                return

            with connect() as conn:
                q.update_blog_post_done(
                    conn, bp_id=bp_id, slug=slug,
                    path=str(file_path.relative_to(vault_dir())),
                    title=title, tags=tags, model=model_used,
                    word_count=len(body_md.split()),
                    body_preview=body_md[:400],
                )
                for n, cand in enumerate(ranked, start=1):
                    q.insert_blog_post_source(
                        conn, blog_post_id=bp_id,
                        kind=cand["kind"], ref=str(cand["ref"]),
                        rank=n, used=(n in cited_ns),
                        origin=cand.get("origin"),
                    )
            self.emit_feed(
                verb="blog-done", obj=str(bp_id), kind="blog_post",
                payload={"title": title, "model": model_used, "word_count": len(body_md.split())},
            )
        except Exception as e:
            # Mirror Roundtable's pattern: write our own row's status here, then
            # re-raise so the base class also marks the `jobs` row failed. Both
            # rows reflect the failure.
            with connect() as conn:
                q.update_blog_post_status(
                    conn, bp_id=bp_id, status="failed", error=str(e)[:500],
                    finished=True,
                )
            raise
```

**Note on failure handling.** `Agent._handle` in `src/mastisk/agents/base.py` is wrapped by `run_once`, which calls `_mark_running` → `_handle` → `_mark_done` on success and `_mark_failed` on any raise. We mirror Roundtable's pattern (`src/mastisk/agents/roundtable.py`): we update our own `blog_posts` row inside the except block and then re-raise so the base wrapper also marks the `jobs` row failed. Both rows reflect the failure — no early `return` + private `_fail` helper.

**Regenerate semantics.** The route handler for regenerate:
1. Validates status ∈ {done, failed}.
2. With one DB txn: CASCADE-deletes `blog_post_sources` for the bp_id, resets the row (`status='pending'`, `error=NULL`, `finished_at=NULL`, `title=NULL`, `word_count=NULL`, `model=NULL`).
3. Enqueues a fresh `jobs(agent='blog_writer', kind='draft', payload_json={blog_post_id})`.

The file on disk is NOT deleted up front — the new run's atomic_write replaces it on success. If the new run fails, the old file remains (and the DB says `status='failed'` with stale content on disk). That's acceptable: the user can regenerate again or delete.

**Fallback order in `_call_llm`:**
1. `claude_bridge.run_claude(prompt, timeout_s=blog.claude_timeout_seconds)`. Parse the response with `json.loads` per §8.4.
2. On `ClaudeError` (quota/timeout/binary-missing) or JSON-parse failure: build a truncated Ollama prompt (see next paragraph) and call `ollama_bridge.run_ollama(ollama_prompt, model=blog.ollama_model)`. Parse the response with `json.loads`.
3. On both failing: return `(None, "none")` → the `except` block in `_handle` writes `status='failed'` and raises.

**Ollama prompt budget.** The primary prompt targets Claude, which handles large context. `llama3.1:8b` (default Ollama fallback) degrades past roughly 16–32k context. Before calling Ollama we re-render the sources block with further-truncated per-source bodies so the final string stays within `blog.ollama_prompt_char_limit` (default 20,000 chars). Truncation applies BEFORE the Ollama call; we do not retry at a larger size. If the post-truncation prompt still exceeds the cap (unlikely — truncation floors at 300 chars/source), drop tail sources until it fits.

The prompt shape is identical for both models — identity preamble, theme, sources, constraints, output contract — only the per-source truncation differs.

**Boot-time reclaim of orphaned `running` drafts.** The daemon can crash mid-draft (laptop sleep, process killed, OOM, etc.). We piggyback on the scheduler's existing `_reclaim_orphaned_running` pattern (`src/mastisk/scheduler.py:207`) which already rescues stuck `jobs` rows. For `blog_posts`, add a companion sweep at daemon boot: scan `blog_posts WHERE status='running' AND created_at < now() - 1h` and flip each to `status='failed'`, `error='daemon restart during draft'`, `finished_at=now()`. Runs once on startup, after schema init, before agents start their first tick. Stale file on disk (if the crash happened after `atomic_write`) is left in place — the row says `failed`, the user can regenerate or delete.

---

## 14. Frontend Surfaces

### 14.1 Sidebar entry

Below "Roundtables" and above or alongside "Repos" — mirror the Notes/Repos pattern with a `+` button to the right:

```tsx
<div className="side-row-group" style={{ display: 'flex', alignItems: 'center' }}>
  <div
    className={`side-row ${currentView === 'blog' || currentView === 'blog_post' ? 'active' : ''}`}
    onClick={() => onNavigate('blog')}
    style={{ flex: 1 }}
  >
    <span className="glyph">✒</span>
    <span className="label">Blog</span>
  </div>
  <button
    onClick={(e) => { e.stopPropagation(); onDraftBlog(); }}
    title="Draft a blog post"
    aria-label="Draft a blog post"
    style={/* same inline styles as Notes/Repos + buttons */}
  >+</button>
</div>
```

`App.tsx` tracks `blogDraftOpen` state (mirrors `captureOpen` / `addRepoOpen`) and passes `onDraftBlog={() => setBlogDraftOpen(true)}` + renders `<BlogDraftModal open={...} onClose={...} onCreated={(id) => navigate('blog_post', String(id))} />`.

### 14.2 `BlogDraftModal`

- Header: "Draft a blog post"
- Field 1 (optional): Theme — `<textarea>` with placeholder "Leave blank to let the writer find the strongest thread across your recent work." (Blur-saves; no validation beyond length.)
- Field 2: Window slider — four discrete steps (7 / 14 / 30 / 90), default 14. Render as a segmented control (not an HTML range slider) for clarity.
- Footer: "Cancel" · "Draft" (primary). Click → POST `/api/blog-posts` → on 202, close modal + navigate to `/blog/:id`. On 422 (empty pool), render inline error + keep modal open.

### 14.3 `BlogListView` (`/blog`)

A list of recent drafts: title, preview (first 400 chars), theme chip, word count, created date, status badge (pending / running / done / failed). Status badge polls if `pending`/`running`. Click → detail view.

Top-right: "+ New draft" button that opens the same `BlogDraftModal`.

### 14.4 `BlogView` (`/blog/:id`)

- Header: title (or "Drafting…" while pending), theme chip, window chip, model chip, created/finished timestamps.
- Body: rendered markdown with citations replaced by clickable `[N]` links (see §11 Citation rendering contract).
- Sidebar/rail panel: a "Sources" list showing all ranked candidates, visually distinguishing `used` (cited) from `offered` (unused). Each source has a link to its `/notes/:id` | `/a/:slug` | `/roundtables/:id` view and a small pill showing its rank. This doubles as the provenance audit trail.
- Action buttons: "Open in editor" (copies the absolute path — frontend joins the API's `path` with the vault root it fetches from `/api/info`), "Regenerate" (POST), "Save as note" (POST, disabled until `status='done'`), "Delete" (DELETE with confirm).

Polling: while `status ∈ {pending, running}`, poll `GET /api/blog-posts/:id` every 2s (matches Roundtable pattern). Stop on `done`/`failed`.

### 14.5 `types.ts` additions

```ts
export interface BlogSource {
  n: number;
  kind: 'note' | 'article' | 'roundtable';
  ref: string;
  used: boolean;
  origin?: string | null;
  resolved: {
    title?: string;
    summary?: string;
    slug?: string;
    deleted: boolean;   // true → render citation as inert span (see §14.4)
  };
}

export interface BlogPostSummary {
  id: number;
  slug: string;
  path: string;
  title: string | null;
  theme: string;
  window_days: number;
  status: 'pending' | 'running' | 'done' | 'failed';
  model: string | null;
  tags: string[];
  word_count: number | null;
  body_preview: string | null;
  created_at: string;
  finished_at: string | null;
  saved_as_note_id: number | null;
}

export interface BlogPost extends BlogPostSummary {
  body_md: string | null;
  error: string | null;
  sources: BlogSource[];
}

export type View =
  | /* existing */
  | 'blog' | 'blog_post';
```

### 14.6 Router entries

```
/blog         → view='blog'
/blog/:id     → view='blog_post', blogPostId=N
```

Mirror the `/roundtables/:id` / `/notes/:id` parse + emit blocks in `router.ts`.

---

## 15. CLI Commands

Append to `cli.py`:

```python
@app.command()
def blog(
    theme: str | None = typer.Argument(None, help="Optional theme. Omit to open $EDITOR."),
    window_days: int = typer.Option(14, "--window", "-w", help="Source window: 7/14/30/90."),
) -> None:
    """Draft a blog post from recent synthesis. Outputs vault/blog/drafts/<slug>.md."""
    # Same $EDITOR fallback as `mastisk note` / `mastisk roundtable`.
    # Validate window_days ∈ {7,14,30,90}.
    # Call queries + enqueue directly — matches the `note` and `roundtable`
    # CLI pattern (verified in src/mastisk/cli.py: `note` calls q.insert_note
    # + atomic_write; `roundtable` calls q.create_roundtable + enqueue).
    # The command writes a `blog_posts` row with status='pending' and enqueues
    # a `jobs(agent='blog_writer', ...)` row. The daemon is required to
    # actually PROCESS the job (pick it up via the scheduler tick), but NOT
    # required for the CLI command to succeed.
    # Print: "created blog post #N — daemon will draft it; poll via PWA or
    # `mastisk status`."

@app.command(name="list-blogs")
def list_blogs() -> None:
    """List recent blog drafts (title, status, word count, path).
    Reads blog_posts directly via queries — does not hit the API."""
```

`mastisk blog` with no theme and no TTY (automation): draft with theme="" and window=14. `mastisk blog` in a TTY: opens `$EDITOR` with a prompt header to collect the theme (matching `note` / `roundtable`).

**Daemon-not-required.** Because the CLI writes DB rows directly, `mastisk blog` succeeds even if no daemon is running; the job sits in the queue until a daemon (via `mastisk start` or the launchd agent) picks it up on its next scheduler tick. This matches how `mastisk note` / `mastisk roundtable` behave today.

---

## 16. Compounding Properties

This is the whole point — the blog writer is not a terminal output. It's a recycler.

- ✅ **Citations link back to source items.** Every `[source N]` in a draft resolves to `/notes/:id`, `/a/:slug`, or `/roundtables/:id`. Clicking lands you on the exact item the claim came from. This makes the draft a navigation hub, not a dead text file.
- ✅ **Drafts can become notes.** `POST /api/blog-posts/:id/save-as-note` routes the draft body (or a preview thereof) into `vault/_notes/inbox/` → the Notetaker classifies it → the Escalator may research its claims → a future blog draft can cite *this* blog draft's note.
- ✅ **Blog drafts are discoverable as future sources.** Because the saved note lives in `notes` and carries `source='pwa'` (or similar), it's in the candidate pool for the next blog draft's source selection. A blog about "my 2026 Q2 thinking on agents" can cite an earlier blog about "agent memory pitfalls" if its saved note is recent enough.
- ✅ **Obsidian round-trip.** The markdown file in `vault/blog/drafts/` opens cleanly in Obsidian. User edits body freely; frontmatter gives provenance. Edits don't round-trip back to the DB automatically — the file is authoritative for reading, the DB is authoritative for query. If we later add a file→DB reconciliation pass (like Notes), it follows the same hybrid model.
- ✅ **Roundtable-on-note path covers critique.** A user who wants models to critique a finished draft uses `save-as-note` → then runs a roundtable on the resulting note. That's the single compounding path v1 supports; no forward reference to Roundtable extending its own `input_type` is needed here.

**Anti-compounding we avoided:**
- No output-only terminal artifact: the draft has at least three downstream consumers (citations-as-navigation, save-as-note, future-source-for-next-draft).
- No human-only view: the API exposes `body_md` + structured `sources[]`. Anything the UI does, a script can do.
- No silent discard of unused sources: `blog_post_sources.used=0` rows let us audit ranking + improve the selector later.

---

## 17. Failure Modes & Fallback

| case | handling |
|---|---|
| Empty source pool at POST time | Route returns 422 `{"detail": "no sources in window — try widening window_days"}`. No row inserted. |
| Empty source pool at agent time (race) | `status='failed'`, `error='no sources in window'`. |
| Claude timeout | `claude_bridge` raises `ClaudeError`; agent falls back to Ollama. |
| Claude non-JSON output | `json.loads(result["text"].strip())` raises `JSONDecodeError`. One retry with the prompt appended `"Your previous response was not valid JSON. Return a bare JSON object exactly matching the schema above — no fences, no preamble."`. If that also fails, fall through to Ollama. |
| Ollama also fails or returns non-JSON | `status='failed'`, `error='LLM failed (claude: ...; ollama: ...)'`. User can regenerate. |
| Claude hallucinates a source N outside 1..len(candidates) | Bracket stripped from the body; logged with `log.warning`. The draft still renders; the stripped region reads as plain prose. |
| User saves-as-note while status='pending' | 409 `{"detail": "blog post not finished"}`. |
| User saves-as-note twice | Second call returns the existing note_id + `reused: true` (idempotent, matches Roundtable). |
| User regenerates while status='pending'/'running' | 409. (Don't race the in-flight job.) |
| User regenerates with a stale job still in the queue (row flipped to done/failed but a new blog_writer job for this id is queued/running) | 409 via the extra jobs-queue precondition on POST `/regenerate`. See §11. |
| User deletes while job is running | `deleted_at` set immediately; agent's `_handle` re-queries `blog_posts.deleted_at` at three points: (a) start of `_handle`, (b) immediately before the `atomic_write`, and (c) immediately after `atomic_write` (see §13 steps 6–8). If any check finds `deleted_at` set, the agent does NOT flip status to `done`; if the write already landed it unlinks the file. This replaces the earlier "cleanup runs delete on completion" sketch with a concrete mechanism. |
| Source item deleted between draft creation and view | `/api/blog-posts/:id` returns `sources[n].resolved = {title: "(note deleted)", deleted: true}` (or article/roundtable equivalent). The PWA renders the citation as an inert `<span class="citation-deleted">[N]</span>` (no href, tooltip "source deleted") per §14.4. No backfill/repair. |
| Theme text containing prompt-injection into the DRAFT prompt | Theme is passed as a constrained string inside a labeled section of the Claude draft prompt. Standard prompt-injection hygiene applies (same as Roundtable's prompt field). Not a new threat surface for the draft step. |
| Theme text injected into the Ollama RERANK prompt | This IS a new injection surface (Roundtable has no rerank). Mitigation: the rerank prompt returns a constrained structure — a JSON list of integers in the source-pool index range. Output is validated: must parse as JSON, must be a list (or `{"relevant": [...]}`), and every element must be an integer in `[0, len(sources))`. Out-of-range, non-integer, or malformed output triggers fallback to the recency-only ranking and the rerank is discarded. |
| Vault file missing at render time | `GET /api/blog-posts/:id` lazy-reads `body_md` from disk. If the file is gone but the row exists, the response is HTTP 200 with `body_md: null` and `error: "file missing"` (the row is still browsable — list views continue to use `body_preview` independently; `body_preview` is a list-view-only field and is NOT substituted into `body_md`). The PWA renders an empty-state with the error. (The file CAN disappear because the vault is in iCloud and the user may unsubscribe/move it.) |
| Disk write fails mid-save | Atomic write via NamedTemporaryFile + os.rename (existing `atomic_write` helper). Partial files never land. |

---

## 18. Testing Strategy

Mirrors Roundtable and Notes patterns. Mock Claude + Ollama bridges.

**Unit:**

- `test_blog_writer_selection.py` — candidate gathering for each source type, window boundary (exactly at cutoff vs. one second before), empty pool, origin='repo_ideator' tagging.
- `test_blog_writer_ranking.py` — keyword-mode ordering, theme-mode LLM-rerank success, theme-mode LLM-rerank fallback to keyword on Ollama failure.
- `test_blog_writer_postprocess.py` — citation parsing (single `[source 3]`, multi `[source 3, source 7]`, out-of-range `[source 99]` gets stripped, zero citations case).
- `test_blog_writer_agent.py` — full happy path (mocked LLM returns a JSON block with `[source 1]` and `[source 3]` in body), failed path, double-process guard, deleted-mid-run guard.
- `test_blog_route.py` — POST with empty pool → 422, POST valid → 202 + row, GET list/detail shapes, regenerate legality matrix, save-as-note idempotency + 409 on unfinished, DELETE unlinks file.

**Integration:**

- `test_blog_end_to_end.py` — seed a handful of notes/articles/roundtables into a tmp vault; POST; wait for scheduler tick; assert file appears + DB row flips to `done` + citations are clickable by checking `sources[].resolved` is populated.

**E2E smoke (manual):**
```bash
mastisk blog "test-time compute" --window 14
# wait ~60-120s
ls vault/blog/drafts/  # should show 2026-04-22-*.md
```

---

## 19. Implementation Phases

1. **Phase A — Schema + paths + settings.** Tables in `schema.sql`, `blog_dir()`/`blog_drafts_dir()` in `paths.py`, `BlogSettings` in `settings.py`, query helpers in `queries.py`. Smoke test via `init_schema`.
2. **Phase B — Agent + source selection.** `agents/blog_writer.py` with `_gather_sources`, `_rank`, prompt assembly, Claude/Ollama call, post-processing, file write. Unit tests mocking both bridges.
3. **Phase C — API route.** `routes/blog_route.py` — POST/GET list/GET detail/regenerate/save-as-note/DELETE. Route tests.
4. **Phase D — Scheduler + CLI.** Register `BlogWriter` in `scheduler.py`; `mastisk blog` + `mastisk list-blogs` in `cli.py`.
5. **Phase E — Frontend.** `BlogDraftModal`, `BlogListView`, `BlogView` with citation rendering, sidebar entry + `+` button, routes, types, api client.
6. **Phase F — Polish.** README updates; document the `vault/blog/drafts/` layout; smoke-test the round-trip (draft → save-as-note → referenced from next draft).

Each phase ships as its own PR, reviewed per the two-subagent pattern.

---

## 20. Open Questions

Short list — defaults picked for everything; these are the only things worth flagging.

- **Future work (out of scope for this spec):** one could imagine extending `roundtables.input_type` to accept a blog draft directly, skipping the save-as-note hop. That belongs in a Roundtable-side spec if/when it's prioritized. This spec does not depend on it; the compounding path is "save blog as note → run roundtable on the note."
- **Do we need a "draft" status distinct from "done"?** i.e. "the agent finished, but the user hasn't reviewed it yet." Recommended default: **no**. `done` + the `saved_as_note_id` column (null = not yet saved) already express this. A review flag is premature.
- **Should regenerate preserve source history?** Currently it CASCADE-deletes `blog_post_sources` and repopulates. Recommended default: **yes, delete.** Sources-per-run can be recovered from the file's frontmatter (which regenerate overwrites, but git/iCloud history has old copies). Keeping multi-generation source history in SQL would need a `generation` column and complicates queries for zero user value in v1.
- **Per-source char limit of 1500.** Recommended default: **ship with 1500, revisit after dogfooding.** If Claude's output is weak-to-cited sources because it didn't have enough of each, bump to 3000. This is a cheap tunable.
- **Window slider values 7/14/30/90.** Recommended default: **keep as-is.** If the 90-day case is consistently too expensive (too many candidates → too many tokens), truncate earlier in the pipeline before expanding the option set.

These don't block implementation.

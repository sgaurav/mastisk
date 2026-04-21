# Notes Subsystem — Design Spec

**Status:** Approved for planning (2026-04-21)
**Author:** Sushil + Claude Opus 4.7 (brainstorming session)
**Scope:** First of three compounding subsystems for mastisk. See `project_mastisk_vision` memory for the broader roadmap (Notes → Multi-LLM Roundtable → GitHub Context Agent).

---

## 1. Context & Goals

Mastisk today is outbound-only: Scout/Listener pull external content into a wiki. This subsystem adds an inbound channel — the user captures their own thoughts, and the system processes them into a first-class input to the wiki pipeline.

**Goals:**

1. **Friction-free capture** from PWA (Mac + phone), CLI, and any editor that can write to the iCloud vault.
2. **Every note gets classified and graph-linked** by a local (Ollama) agent without touching the user's prose.
3. **High-value notes auto-escalate to research** via Claude, producing wiki-article stubs that flow through the existing Synthesizer pipeline.
4. **Compounding:** notes become substrate for the wiki; research about notes becomes substrate for future notes; nothing is terminal.

**Success criteria:**

- Capture a note from the phone PWA → classified within 60 seconds → visible in PWA with related-article links.
- Write a markdown file into `vault/_notes/inbox/` from Obsidian → same outcome, no PWA involvement.
- Dump 15 notes at bedtime → all classified within 5 minutes; auto-escalation stays within the daily cap.
- Ollama down → classification retries; Claude quota exhausted → escalation defers and retries; no silent data loss.

---

## 2. Non-Goals (v1)

- Voice capture (deferred; mlx-whisper already present but UI + pipeline is scope).
- FSEvents-based real-time watcher (polling every 30s is sufficient).
- Bundled iOS Shortcut (user can author once vault drop works).
- Global macOS hotkey (Raycast/Alfred covers this via CLI).
- Apple Notes / Reminders sync.
- Note editing inside the PWA (PWA captures + reads; edit in Obsidian / any editor).
- ML-trained auto-escalation decision (v1 uses a deterministic rule).
- Classification dedup (same thought typed twice → two notes; only *escalation* is deduped).

---

## 3. Architecture

```
Capture surfaces              vault (iCloud source of truth)          agents                   downstream
─────────────────             ────────────────────────────            ─────                    ──────────
PWA "+" ──┐                                                           ┌─ notetaker.py  ───┐
          ├─► writes ───► vault/_notes/inbox/<ts>-<slug>.md  ───watch─►  (Ollama)         │
CLI ──────┤                                                           │  classify + link  │
          │                                                           │  write frontmatter│
Any editor┘                                                           │  mv inbox→dated/  │
(Obsidian, Files, Shortcut)                                           └─────────┬──────────┘
                                                                                │ enqueue jobs
                                                                                │ (agent='escalator',
                                                                                │  kind='evaluate')
                                                                                ▼
                                                                      ┌─ escalator.py ────┐
                                                                      │  (Claude, caps)   │
                                                                      │  rule + dedup     │
                                                                      │  create stub      │
                                                                      │  retry/fallback   │
                                                                      └─────────┬──────────┘
                                                                                │ stub row
                                                                                ▼
                                                                      existing synthesizer.py
                                                                      + compiler.py + artifact_agent.py
                                                                      → real wiki article
```

**Storage model (Pattern 3 — hybrid):** iCloud markdown files are the source of truth. The SQLite DB is a derived index for fast query and graph traversal. Files canonical; DB reproducible from files.

**Agent granularity (Approach 2 — split):** Two new agents, `notetaker` (fast/local/Ollama) and `escalator` (quota-aware/Claude). Stubs created by the escalator feed the existing `synthesizer` unchanged.

---

## 4. Components

| kind | path | new? | purpose |
|---|---|---|---|
| API route | `src/mastisk/routes/notes.py` | new | `POST /api/notes`, `GET /api/notes`, `GET /api/notes/:id`, `POST /api/notes/:id/escalate`, `DELETE /api/notes/:id`, `GET /api/notes/:id/file` |
| Agent | `src/mastisk/agents/notetaker.py` | new | Classify, link, frontmatter write, inbox → dated move, index into DB |
| Agent | `src/mastisk/agents/escalator.py` | new | Auto-rule, daily cap, dedup, stub creation, Claude retry, Ollama fallback |
| CLI | `src/mastisk/cli.py` | edit | Add `mastisk note [TEXT]` (opens `$EDITOR` if no arg) |
| Scheduler | `src/mastisk/scheduler.py` | edit | Three new `sched.add_job` registrations: `notetaker` agent tick (30s — filesystem scan + classify batch), `escalator` agent tick (60s — retry reactivation + evaluate), `vault_integrity` plain-function tick (5min — tombstone notes whose file was deleted). Follow the existing Scout/Listener `try/except import + add_job` pattern. |
| Frontend | `frontend/src/components/NoteCaptureModal.tsx`, `NotesView.tsx`, `NoteView.tsx`; update `App.tsx`, `types.ts` (`View` discriminator), `router.ts`, `Titlebar.tsx` | new | Capture modal (pattern from `AskDrawer`), notes-list view, note-detail view with "Research this" button. Extend existing `view` switch in `App.tsx` — no separate `Home.tsx` / `routes/` directory in this codebase. Auto-escalation toast piggybacks on existing SSE (see §7). |
| DB schema | `src/mastisk/db/schema.sql` (append) | edit | Three new tables: `notes`, `note_links`, `note_escalations`, all with `CREATE TABLE IF NOT EXISTS` to match existing pattern |
| DB post-init | `src/mastisk/db/queries.py` (`init_schema`) | edit | After `executescript`, run idempotent `ALTER TABLE articles ADD COLUMN source_note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL` and swallow the "duplicate column" error. Mastisk has no migrations framework; this is the simplest forward-compat path. |
| Config | `~/Library/Application Support/Mastisk/config.toml` | edit | New `[notes]` section |
| Vault layout | `vault/_notes/{inbox,YYYY-MM-DD,daily}/` | new | Document in README |

---

## 5. File Conventions

```
vault/_notes/
    inbox/                          — staging; files here are unclassified
        <timestamp>-<slug>.md
    YYYY-MM-DD/                     — classified notes, organized by capture date
        HHMMSS-<slug>.md
    daily/                          — derived digests (Notetaker writes on first run per day)
        YYYY-MM-DD.md
```

**Filename rule:** `<HHMMSS>-<slug>.md` where slug is a lowercased-dashed version of the first 60 chars of the note body, stripped of punctuation. If a bulk-paste CLI dumps two notes within the same second, append `-2`, `-3` on UNIQUE constraint collision. The capture layer retries insert on `sqlite3.IntegrityError` with incremented suffix until it lands (cap at `-99` and log loudly).

**Frontmatter (written by Notetaker, never by user):**

```yaml
---
created_at: 2026-04-21T14:35:22-07:00
classified_at: 2026-04-21T14:35:45-07:00
classification: idea            # insight | question | idea | todo | observation | rant
summary: "One-sentence capture of what this note is about"
confidence: 0.82                # Notetaker self-rating, 0..1
tags: [ai-agents, mastisk, compounding]
related_articles: [test-time-compute, agent-memory]   # wiki slugs
escalation_state: auto_done     # none | auto_done | manual_done | pending | retrying | skipped_cap | skipped_dup | failed
escalation_article_slug: user-note-on-compounding     # human-readable; nullable; DB stores canonical id
---

(user's prose below, untouched)
```

**Rule: prose is sacred.** The Notetaker never modifies the body. If a user edits the body after classification, the next scan re-classifies (detected by mtime).

---

## 6. Database Schema

**Integration pattern:** Mastisk uses a single `db/schema.sql` that runs with `CREATE TABLE IF NOT EXISTS` on every startup (see `queries.py::init_schema`). New tables append cleanly. The one schema-altering change (a new column on `articles`) has no `IF NOT EXISTS` equivalent in SQLite, so it runs as a post-init idempotent `ALTER TABLE` that swallows the "duplicate column" error.

**Append to `db/schema.sql`:**

```sql
-- Notes: user-authored content. File is source of truth; this row is a derived index.
CREATE TABLE IF NOT EXISTS notes (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug                        TEXT UNIQUE NOT NULL,            -- '<HHMMSS>-<slug>', unique within a day but we also add a monotonic suffix if collisions happen
    path                        TEXT UNIQUE NOT NULL,            -- relative to vault root, e.g. '_notes/2026-04-21/143522-foo.md'
    body                        TEXT NOT NULL,                   -- snapshot at classify time; file is canonical
    body_sha256                 TEXT NOT NULL,                   -- for change detection
    source                      TEXT NOT NULL,                   -- 'pwa' | 'cli' | 'file'
    created_at                  DATETIME NOT NULL,
    classified_at               DATETIME,
    classification              TEXT,                            -- insight|question|idea|todo|observation|rant
    summary                     TEXT,
    confidence                  REAL,
    tags_json                   TEXT DEFAULT '[]',               -- JSON array of strings
    escalation_state            TEXT NOT NULL DEFAULT 'none',    -- none|pending|retrying|auto_done|manual_done|skipped_cap|skipped_dup|failed
    escalation_trigger          TEXT,                            -- 'manual' | 'auto' | null
    escalation_article_id       TEXT REFERENCES articles(id) ON DELETE SET NULL,
    escalation_retry_count      INTEGER NOT NULL DEFAULT 0,
    escalation_next_attempt_at  DATETIME,
    deleted_at                  DATETIME                         -- tombstone; file-not-found triggers this
);

CREATE INDEX IF NOT EXISTS idx_notes_created_at         ON notes(created_at);
CREATE INDEX IF NOT EXISTS idx_notes_classified_at      ON notes(classified_at);
CREATE INDEX IF NOT EXISTS idx_notes_escalation_pending ON notes(escalation_state, escalation_next_attempt_at)
    WHERE escalation_state IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_notes_deleted_at         ON notes(deleted_at);

-- Note ↔ article graph links (matches existing `links` table pattern: article id is TEXT).
CREATE TABLE IF NOT EXISTS note_links (
    note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    article_id  TEXT    NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    rank        INTEGER NOT NULL,                                -- 0 = most relevant
    PRIMARY KEY (note_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_note_links_article ON note_links(article_id);

-- Escalation attempts: one row per (note, try). Lets us observe retry history + aggregate for daily cap.
CREATE TABLE IF NOT EXISTS note_escalations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id       INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    triggered_at  DATETIME NOT NULL,
    trigger       TEXT NOT NULL,                                 -- 'manual' | 'auto'
    result        TEXT NOT NULL,                                 -- 'stub_created' | 'failed'
    stub_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
    error         TEXT,
    model         TEXT NOT NULL                                  -- 'claude' | 'ollama'  (which served this attempt)
);

CREATE INDEX IF NOT EXISTS idx_note_escalations_note         ON note_escalations(note_id);
CREATE INDEX IF NOT EXISTS idx_note_escalations_triggered_at ON note_escalations(triggered_at);
```

**Post-init idempotent ALTER (in `queries.py::init_schema`, after `executescript`):**

```python
_POST_INIT_ALTERS = [
    # Forward-link from article back to originating note. Nullable, non-breaking.
    "ALTER TABLE articles ADD COLUMN source_note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL",
]

for alter in _POST_INIT_ALTERS:
    try:
        c.execute(alter)
    except sqlite3.OperationalError as e:
        if "duplicate column name" not in str(e).lower():
            raise
```

**Why body snapshot + sha256:** file-not-found (user deleted via Obsidian) still lets us surface the note as a tombstone. The sha256 lets us detect "user edited the prose" during a scan without re-reading the file on every tick.

**Queueing:** reuse the existing `jobs` table (`agent='notetaker'|'escalator'`, `kind='classify'|'escalate'`, `payload_json='{"note_id": 42}'`). Don't invent a new queue. The scheduler already polls `jobs`.

---

## 7. API Surface

```
POST   /api/notes
       body: {"text": "raw markdown body", "source": "pwa" | "cli"}
       → 201, {"id": 42, "slug": "...", "path": "_notes/inbox/..."}

GET    /api/notes?limit=50&before=<note_id>&classification=idea
       → 200, [{id, slug, created_at, classification, summary, tags, escalation_state}, ...]

GET    /api/notes/:id
       → 200, full note including body, related_articles, escalation history

POST   /api/notes/:id/escalate
       body: {}   (manual trigger; bypasses auto-rule but not Claude retry logic)
       → 202, {"escalation_state": "pending"}

DELETE /api/notes/:id
       → 204; soft-deletes DB row (deleted_at), deletes the vault file

GET    /api/notes/:id/file
       → 200, text/markdown — raw file content
```

**Toast via existing SSE:** the current stream (`feed_route.py::feed_stream`) emits only `event: tick` events carrying `feed` rows. Rather than adding a new event type, the Escalator writes a `feed` row with `agent='escalator', verb='auto-escalated', obj=<note_id>, kind='note'` via the standard `emit_feed()` helper. The PWA's existing `stream.ts` subscription delivers this row; `App.tsx` inspects incoming feed rows for the `escalator/auto-escalated` combination and surfaces a toast component (new, small). Zero backend stream changes.

---

## 8. Configuration (`config.toml`)

```toml
[notes]
# Capture
classify_stable_mtime_seconds = 30    # slow-path: wait N seconds of no modification before classifying

# Auto-escalation rule
auto_escalate_cap            = 20              # max per calendar day (local tz)
auto_escalate_min_confidence = 0.7
auto_escalate_min_length     = 80              # chars
auto_escalate_classifications = ["idea", "question"]
dedup_hours                  = 24              # don't auto-escalate near-dup within N hours
dedup_similarity_threshold   = 0.85            # cosine similarity on summary embedding

# Claude retry
claude_retry_count         = 2
claude_retry_backoff_mins  = [30, 60]

# Model selection
notetaker_model         = "llama3.1:8b"        # Ollama
escalator_model         = "claude-sonnet-4-6"  # via claude CLI bridge
notetaker_concurrency   = 4                    # parallel classifications
```

All keys have defaults; missing `[notes]` section loads defaults.

---

## 9. Data Flow

### 9.1 Capture → Classification (normal path)

1. **Capture.** Either:
   - PWA `POST /api/notes` → route writes file to `inbox/` atomically (`NamedTemporaryFile` + `os.rename`) → inserts `notes` row with `source='pwa'`, `classification=null` → returns 201.
   - CLI `mastisk note "text"` → same path via API.
   - External editor writes to `inbox/` directly → no DB row yet; picked up by scanner.

2. **Scan tick (Notetaker's own `run_once`, 30s cadence).** The Notetaker agent's tick does filesystem work *before* consulting the `jobs` queue:
   - List `inbox/*.md`.
   - Skip if `.icloud` suffix, leading `.`, conflict-copy pattern (`* (conflicted *).md`), or unstable (see §11 on stability).
   - If filename is unknown to the DB (external-editor case), insert a `notes` row with `source='file'`, `classification=null`.
   - For each new or still-unclassified row, enqueue `jobs(agent='notetaker', kind='classify', payload_json='{"note_id": N}')`. Duplicate enqueues are a no-op because step 3's handler checks `classification IS NULL` before acting.

3. **Notetaker classification (up to 4 jobs per tick, concurrent).** Notetaker overrides `Agent.run_once` to batch: it pulls up to `notetaker_concurrency` queued `classify` jobs and runs `_handle` on each under an `asyncio.Semaphore(notetaker_concurrency)` (see §10). Each `_handle`:
   - Read file at DB-recorded path. Compute sha256.
   - Call Ollama with identity/interests prompt + known article ids + note body. Expect structured JSON: `{classification, summary, confidence, tags, related_articles}`.
   - Write YAML frontmatter (preserving the body verbatim).
   - Move file from `inbox/` to `YYYY-MM-DD/`.
   - Update the `notes` row: all classification fields, updated `path`, `classified_at`, `body_sha256`.
   - Insert `note_links` rows (`rank` = order Ollama returned them; article_id validated against `articles`).
   - Emit a `feed` row via `emit_feed(verb='classified', obj=slug, kind='note')`.
   - **Enqueue the next step:** insert `jobs(agent='escalator', kind='evaluate', payload_json='{"note_id": N}')`. This is the only link from Notetaker to Escalator — there is no in-memory event; every hand-off is a `jobs` row so crashes don't lose work.

4. **Daily digest (once per day, on first note of the day).** Notetaker appends to `vault/_notes/daily/YYYY-MM-DD.md`: a stitched-together journal view of that day's notes. Pure view; regenerable.

### 9.2 Escalator tick (evaluates the auto-rule)

The Escalator agent's `run_once` runs every 60s. Each tick does two things:

1. **Re-enqueue due retries.** Before picking from the job queue, Escalator scans `notes WHERE escalation_state IN ('pending', 'retrying') AND escalation_next_attempt_at <= now()`. For each, if there is no already-queued `jobs(agent='escalator', kind='evaluate', note_id=N)`, enqueue one. This is how the retry state machine (see §9.3 step 5) gets reactivated on schedule without a `scheduled_for` column on `jobs`.

2. **Process one `evaluate` job per tick** (standard `Agent.run_once` — serial by design; the base class picks one job per tick). The handler proceeds to §9.3 **under the class-level `asyncio.Lock()`**, so rule evaluation + cap check + dedup + stub creation are all race-free. All state transitions including skip outcomes happen inside the lock.

### 9.3 Evaluate handler (both manual and auto paths run through this — only the `trigger` value differs)

Under `asyncio.Lock()`:

1. **Re-load the note row** (another handler may have raced even though serial — be defensive after acquiring any lock).
2. **If `escalation_state` is terminal** (`auto_done`, `manual_done`, `failed`) and the current trigger is `auto`: no-op, return. (Manual re-trigger bypasses this check; re-researching is always allowed on user demand.)
3. **Rule check** (all must hold for `trigger='auto'`; manual bypasses all five):
   - `classification ∈ auto_escalate_classifications`
   - `confidence ≥ auto_escalate_min_confidence`
   - `len(body) ≥ auto_escalate_min_length`
   - Daily count (`SELECT COUNT(*) FROM note_escalations WHERE triggered_at >= local_midnight() AND result='stub_created'`) < `auto_escalate_cap`
   - No `note_escalations` row in last `dedup_hours` with summary-embedding cosine ≥ `dedup_similarity_threshold` (fall back to substring if embeddings unavailable — see §15).
4. **Rule fails** → transition `escalation_state` to `skipped_cap` / `skipped_dup` / `none` (pick based on which rule failed), insert a `note_escalations` row with `result='failed', error='<rule>'`, emit a feed row, return.
5. **Rule passes** → transition `escalation_state = pending`. Call `claude_bridge.run_claude(prompt=...)` with:
   - Identity context (from `Agent.load_identity()`)
   - The note body
   - A list of known-article ids (for linking)
   - A prompt instructing Claude to reply with a single JSON block containing `{title, kind ∈ {Concept, Entity, Synthesis}, framing_paragraph, research_questions[]}`.

   **Output parsing:** `run_claude` returns a dict `{"text": <assistant message>, "raw": <full stdout>}` — NOT a parsed object. Extract the JSON using the existing `claude_bridge.extract_json_block(result["text"])` helper. A parse failure is a `ClaudeError`-equivalent: fall into the retry path in step 7.
6. **On success:**
   - Derive stub id: `f"note-{note_id:06d}-{slugify(title)[:40]}"`. Collision-safe because `note_id` is unique; in the vanishingly-unlikely case of collision with an existing article (e.g. rerun after a DB rebuild), append `-2`/`-3` suffix.
   - **Add a new helper** `ensure_note_stub_article(conn, *, id, title, kind, summary, body_md, source_note_id)` in `db/queries.py`. The existing `ensure_stub_article` is wrong for this job — it hardcodes `updated_by='Compiler (stub)'`, `kind='Entity'`, and a placeholder summary, and its `INSERT` doesn't accept `body_md`, `summary`, or `source_note_id`. The new helper inserts with `updated_by='escalator (stub)'`, `confidence=0.0`, `kind=<Claude's answer>`, `summary=framing_paragraph`, `body_md='\n\n'.join(['## Research questions', *questions])`, and `source_note_id=note.id`. Same idempotency contract (returns False if id exists; never overwrites).
   - Do **not** invent new columns. There is no `status` or `source` column on `articles` in this schema.
   - Update note: `escalation_state ∈ {auto_done, manual_done}` based on trigger, `escalation_article_id = <stub.id>`.
   - Rewrite the note's YAML frontmatter (preserving body) with `escalation_article_slug` set to the human-readable slug (for Obsidian visibility).
   - Insert `note_escalations(trigger, result='stub_created', stub_article_id=<stub.id>, model='claude')`.
   - `emit_feed(verb='auto-escalated' if trigger=='auto' else 'escalated', obj=str(note_id), kind='note', payload={'stub_id': stub.id, 'title': title})`. `obj` MUST be a string to match every other feed call in the codebase (SQLite is permissive but downstream consumers assume `obj: str`). The PWA's existing SSE stream carries this row; `App.tsx` shows a toast when it sees the `escalator/auto-escalated` combination.
7. **On `ClaudeError`:** (the bridge raises this uniformly for HTTP errors, non-zero exit, timeout — no distinction between rate-limit, prompt error, and network failure; see §11.)
   - `escalation_retry_count += 1`.
   - If retry budget remains (`retry_count <= claude_retry_count`): set `escalation_state='retrying'`, `escalation_next_attempt_at = now + claude_retry_backoff_mins[retry_count - 1]`. Return — the next tick's step §9.2.1 will re-enqueue when due.
   - If retry budget exhausted: fall back to `ollama_bridge.run_ollama(research_prompt)`. Same stub-creation path as step 6, but `model='ollama'` in the escalation row.
   - If Ollama also fails: `escalation_state='failed'`, insert `note_escalations` with `result='failed'`, done. User can manually retry.

Lock released on exit (success, skip, or failure — all paths).

### 9.4 `escalation_state` state machine

Every transition below is a write inside the Escalator's class-level lock (except `none → deleted`, which the vault-integrity job owns). This is the full set — if a phase doesn't appear, it's not a legal transition.

| from            | to              | trigger                                                                 |
|-----------------|-----------------|-------------------------------------------------------------------------|
| `none`          | `pending`       | Evaluate handler, rule passed (auto or manual)                          |
| `none`          | `skipped_cap`   | Evaluate handler, auto rule failed on daily cap                         |
| `none`          | `skipped_dup`   | Evaluate handler, auto rule failed on dedup                             |
| `none`          | `none`          | Evaluate handler, auto rule failed on non-terminal reason (confidence/length/classification — note stays eligible for manual) |
| `pending`       | `auto_done`     | Claude (or Ollama fallback) returned; stub created; trigger was auto    |
| `pending`       | `manual_done`   | Same as above but trigger was manual                                    |
| `pending`       | `retrying`      | Claude raised `ClaudeError`, retry budget remains                       |
| `pending`       | `failed`        | Claude exhausted retries AND Ollama fallback also failed                |
| `retrying`      | `pending`       | Retry-reactivation scan re-enqueued a job; handler picked it up. This is the legal mechanical transition; `retrying → auto_done` and `retrying → failed` appear in practice as a semantic composite (always routed through `pending` first). |
| `retrying`      | `failed`        | Semantic composite: Ollama fallback also failed on the retry (implementation path: `retrying → pending → failed` via the re-enqueue). Listed explicitly so implementers searching for "retrying → failed" find the intent. |
| `skipped_cap`   | `pending`       | User clicked "Research this" manually (manual trigger bypasses cap)     |
| `skipped_dup`   | `pending`       | Same — manual re-trigger                                                |
| `failed`        | `pending`       | Same — manual re-trigger                                                |
| `auto_done`     | `pending`       | Manual re-trigger (user wants fresh research on an already-done note)  |
| `manual_done`   | `pending`       | Same                                                                    |
| any             | (row deleted)   | User deleted the vault file; vault-integrity job sets `deleted_at`, state is frozen |

### 9.5 Deletion

- User deletes `vault/_notes/YYYY-MM-DD/HHMMSS-foo.md` in Obsidian.
- Next `inbox_scan` tick (or dedicated `vault_integrity` tick, 5-min cadence) detects missing files for known DB paths. Sets `deleted_at`.
- Tombstone propagates: PWA list excludes deleted notes; article (if already compiled) keeps its `source_note_id` but the link renders as "(note deleted)".
- No cascade delete. Per Q4 decision (Option B).

---

## 10. Concurrency Model

The base `Agent.run_once` picks exactly one job per tick. Notes bursts (e.g. 15 thoughts dumped at bedtime) would classify one per 30s = 7.5 minutes by default — unacceptable. Notetaker therefore overrides `run_once` to batch; Escalator keeps the base serial behavior and adds a class-level lock.

- **Notetaker — `run_once` override.** Each tick:
  1. Do the filesystem scan of `inbox/` and enqueue `jobs` rows (§9.1 step 2).
  2. Pick up to `notetaker_concurrency` queued jobs via a **Notetaker-private** `_pick_jobs(limit=N)` method (do NOT add this to `Agent` base — no other agent batches). Query mirrors `_pick_job` but with `LIMIT N` instead of `LIMIT 1`.
  3. `asyncio.gather(*handle_with_sem(j) for j in jobs)` where `handle_with_sem` acquires an `asyncio.Semaphore(notetaker_concurrency)` (class attribute, default 4) before calling the standard `_handle`, and is responsible for `_mark_running/_mark_done/_mark_failed` around it. Mirrors the existing base-class contract.

- **Escalator — base `run_once` + class-level lock.** Each tick:
  1. Run the retry-reactivation scan (§9.2 step 1) synchronously under the same lock (bounded, DB-only work).
  2. Call `super().run_once()` to pick one `evaluate` job; `_handle` acquires the class-level `asyncio.Lock()` and runs the evaluate path (§9.3). One Claude call per 60s tick worst case, which keeps quota pressure predictable.

- **Scheduler.** The existing `scheduler.py` is not a registration API; it's a file of hand-rolled `try/except` imports + `sched.add_job(Agent().run_once, "interval", seconds=..., id=..., max_instances=1, coalesce=True, next_run_time=soon)` blocks (one per agent). To add Notetaker (30s) and Escalator (60s), append two blocks mirroring the Scout block. The 5-min `vault_integrity` job runs a plain function (not an Agent subclass), added the same way. `coalesce=True, max_instances=1` are already the established convention.

- **Why two locking patterns?** Notetaker classification is I/O-bound (Ollama, filesystem) and benefits from parallelism. Escalator is quota-bound (Claude) and the cap-check / dedup / stub-create must be atomic — a lock is cheaper and clearer than transactional DB gymnastics. APScheduler's `coalesce=True, max_instances=1` per agent job prevents overlapping ticks even if one hangs.

---

## 11. Error Handling & Edge Cases

| case | handling |
|---|---|
| iCloud placeholder (`.icloud` suffix) | Skipped by scanner. Will be re-evaluated on next tick once downloaded. |
| iCloud conflict copy (`foo (conflicted N).md`, `foo (conflicted copy *).md`) | Skipped by scanner; logged as a feed row with `agent='notetaker', verb='conflict-skipped'`. User resolves manually in Obsidian/Files. |
| File stability (mtime + size) | A file is considered stable only if **both** `mtime` and `size` are unchanged across two ticks `classify_stable_mtime_seconds` apart. Mtime alone isn't enough — iCloud can update the header atom without changing content size, but partial-sync is the real failure mode. Fast-path (PWA/CLI atomic writes) sidesteps this: they set `source='pwa'`/`'cli'` and skip the stability check. |
| Notetaker: Ollama error | Up to 5 retries on successive ticks (25 min total). Then fall back to Claude (costs quota but rare). If Claude also fails, move file to `inbox/stuck/` and log. |
| Notetaker: malformed JSON from Ollama | Retry once with a more structured prompt (`respond with JSON only`). Then stuck. |
| Notetaker: user edits body during classification | Detected when sha256 after write ≠ sha256 before. Re-queue the note, Notetaker runs again. Frontmatter is idempotent (replaced, not appended). |
| Escalator: Claude rate-limited | `claude_bridge.run_claude` raises `ClaudeError` uniformly — the bridge doesn't distinguish rate-limit from prompt error from network failure. Treated identically: retry with exponential backoff per config. Doesn't count toward daily cap until a stub is successfully created. If ever needed, rate-limit-specific detection can be layered in later by parsing stderr for quota/HTTP-429 markers. |
| Escalator: daily cap hit mid-day | `escalation_state = skipped_cap`. User still sees the note. Cap resets at local midnight. |
| Duplicate note content | Classification proceeds (two notes created). Escalator dedup prevents two escalations from near-identical summaries. |
| Auto-escalation during burst | Burst of 30 notes: first 20 auto-escalate, next 10 marked `skipped_cap`. Tomorrow they stay `skipped_cap` (don't roll over). User can manual-escalate any of them. |
| PWA offline | Capture UI shows "queued" state; service worker persists to IndexedDB; retries POST on reconnect. |
| Mastisk process killed mid-classification | Note stays in `inbox/`. Next startup's first scan picks it up. No half-state in DB because DB update is the last step. |
| User manually escalates an already-`auto_done` note | No-op with a UI message ("already researched at X"). |

---

## 12. Testing Strategy

Mirrors the existing mastisk testing pattern (real LLMs in tests, tmp_path for filesystem, pytest-asyncio).

**Unit:**

- `test_notetaker.py` — frontmatter round-tripping, filename slug rules, classification JSON parsing.
- `test_escalator.py` — rule evaluation (all 5 conditions), daily-cap boundary (19 passing + 1 failing at cap), dedup, retry state machine with fake clock.
- `test_notes_route.py` — API request/response shapes, POST → file creation, DELETE → tombstone.

**Integration:**

- `test_capture_to_classified.py` — POST via TestClient → wait for scheduler tick → assert classification visible in DB + file has frontmatter + linked articles present. Uses a local Ollama.
- `test_external_file_drop.py` — write `.md` directly into `inbox/` via tmp_path → tick → classified.
- `test_auto_escalation_end_to_end.py` — capture 25 notes programmatically → assert exactly 20 escalate, 5 marked `skipped_cap`, stubs present in `articles` table.
- `test_claude_retry.py` — mock Claude bridge to fail 2× then succeed → assert state transitions `none → pending → retrying → pending → retrying → pending → auto_done` (each retry re-enters `pending` via the retry-reactivation scan). Drive the fake clock past each backoff window. Verify exactly one stub article is created (not three).

**E2E smoke (manual, one-liner):**
```bash
mastisk note "test-time compute is about spending inference cycles on harder problems"
# wait 60s
mastisk status  # note shows classified, linked to test-time-compute article
```

---

## 13. Compounding Properties

This is a constraint, not a feature. Each check below must hold:

- ✅ **Notes enrich the wiki graph** via `note_links`. Article pages can render "notes referencing this article" as backlinks.
- ✅ **Escalation produces wiki articles** via the existing stub pipeline. Research about notes becomes part of the permanent wiki.
- ✅ **Articles back-reference notes** via `articles.source_note_id`. User can see "this wiki page came from my note on 2026-04-21".
- ✅ **Future Roundtable operates on notes directly.** The `/api/notes/:id` endpoint exposes everything the roundtable will need.
- ✅ **Future GitHub Agent writes ideas as notes.** The agent just writes files into `inbox/` — zero coupling to notes-subsystem code. This is the pattern that makes compounding cheap.

**Anti-compounding things this spec avoids:**
- No output-only terminal artifacts. Every piece (classified note, stub, article) has a downstream consumer.
- No "write-only" metadata fields. Every frontmatter key is queryable via the DB index.
- No human-only views. PWA UI is a consumer like any other — the API returns the canonical data.

---

## 14. Implementation Phases

Sequencing for the implementation plan (this will be detailed by `writing-plans`):

1. **Phase 1 — Capture + storage.** Schema additions in `db/schema.sql`, post-init `ALTER` in `queries.py`, `routes/notes.py`, CLI `mastisk note`, PWA capture modal + notes-list view + API client. No classification yet — files land in `inbox/` without frontmatter; the PWA shows them with `classification=null`. Ship-testable: can capture from PWA/CLI/vault-drop, all three paths show up in `GET /api/notes`.
2. **Phase 2 — Notetaker.** `inbox_scan` scheduler job, `agents/notetaker.py`, frontmatter writer, Ollama bridge prompt, `note_links` insertion, PWA note-detail view. Ship-testable: notes get classified + linked.
3. **Phase 3 — Daily digest.** Notetaker writes `daily/YYYY-MM-DD.md`. PWA exposes daily view. (Small; could fold into Phase 2.)
4. **Phase 4 — Escalator (manual only).** `agents/escalator.py`, manual-escalate API + button, stub creation via `claude_bridge`, article forward-link. Ship-testable: click button → stub appears.
5. **Phase 5 — Auto-escalation rule + retry.** Rule evaluator, daily cap, dedup via embeddings, retry state machine, and the `App.tsx` toast that surfaces on incoming `escalator/auto-escalated` feed rows (piggybacking on the existing SSE stream — no new event type). Ship-testable: dumping 25 notes produces exactly 20 stubs and 5 `skipped_cap` notes; user sees a toast per auto-escalation.
6. **Phase 6 — Hardening.** Vault-integrity scan (tombstones), error-path tests, documentation updates.

Each phase lands as its own commit/PR, each reviewed by 2 subagents per user's preferred pattern.

---

## 15. Open Questions / Known Unknowns

- **Embedding source for dedup.** Existing mastisk uses Ollama `nomic-embed-text` (per README). Reuse it; if not available, fall back to substring comparison on summaries. (Dedup is a rule-evaluator concern; if embeddings unavailable, the rule degrades gracefully.)
- **Classification schema stability.** Starting with `insight | question | idea | todo | observation | rant`. If reflection/retro later suggests different buckets, Notetaker prompt is the only change needed.
- **PWA capture on cold start.** Service-worker queueing for offline capture adds complexity; v1 may ship with "online only" and a clear error on offline post, upgrading to queued-capture as a fast follow.
- **iCloud latency variance.** 30-second stability window is a guess based on anecdote, not measurement. May need tuning after dogfooding.

These don't block implementation. Flagged so the writing-plans phase can slot them as decision points.

# Multi-LLM Roundtable — Design Spec

**Status:** Draft (autonomous, pending user review)
**Author:** Sushil + Claude Opus 4.7
**Date:** 2026-04-22
**Scope:** Second of three compounding subsystems (Notes shipped; GitHub next).

---

## 1. Context & Goals

Mastisk now has Notes. Each note — plus every existing wiki article — is a single-voice artifact: it reflects one model's classification or one model's synthesis. The Roundtable subsystem fans a single input out to multiple LLMs, captures their perspectives side-by-side, and synthesizes them.

Per the user's original brief: *"a way to talk about any idea or note with multiple LLMs — Codex, Claude Code, Ollama together, even Gemini CLI — so that I can get great insights."*

**Goals:**
1. Given a note, article, or free-form prompt, fan out to all configured LLM backends in parallel.
2. Display each perspective individually (raw, side-by-side) AND a synthesis paragraph built from them.
3. Let the user convert a roundtable synthesis into a note (feeding back into Notes / escalator pipeline).
4. Gracefully degrade when a backend isn't installed or is failing.

**Success criteria:**
- User opens a note → clicks "Roundtable" → each available backend produces a perspective within ~30s → synthesis appears → user can accept the synthesis as a new note.
- Zero backends configured == clear error explaining what to install.
- One failing backend doesn't block the others.

---

## 2. Non-Goals (v1)

- Streaming partial tokens from backends (perspectives arrive in one chunk each).
- Cross-backend tool use or function calling.
- Cost/quota tracking per backend beyond the existing Claude daily cap.
- User-authored "roundtable templates" (prompts stored as reusable templates).
- Backend-specific parameter tuning (temperature, model variant) — v1 uses one sensible model per backend.
- Conversation threading inside a roundtable (single-shot Q&A per roundtable).

---

## 3. Architecture

```
Input                           Orchestrator                      Backends (parallel)                  Output
─────                           ────────────                      ───────────────────                  ──────
- note_id                       ┌────────────────┐                ┌─ claude_bridge ──┐
- article_id        ──enqueue──►│ Roundtable agent│──asyncio.gather─┤ codex_bridge   │─┐
- free-form prompt              │  (orchestrator) │                ├─ gemini_bridge  │ │
                                │  one per job    │                └─ ollama_bridge  │ │
                                └────────┬────────┘                                  │ │
                                         │ wait all + synthesize                     │ │
                                         ▼                                           │ │
                                ┌─────────────────┐                                  │ │
                                │ synthesizer call│◄─────────────────────────────────┘ │
                                │  (Claude)       │                                    │
                                └────────┬────────┘                                    │
                                         │                                             │
                                         ▼                                             ▼
                                ┌────────────────────────────────────────────────────────┐
                                │ DB: roundtables + roundtable_perspectives rows         │
                                │ emit_feed(verb='roundtable-done')                      │
                                └──────────────────────┬─────────────────────────────────┘
                                                       │
                                                       ▼
                                                 PWA RoundtableView
                                                 (+ "save synthesis as note" action)
```

**Storage:** two new tables, `roundtables` + `roundtable_perspectives`. No filesystem artifacts — roundtables live entirely in SQLite (unlike notes which are file-first).

**Agent pattern:** a new `Roundtable` agent whose `_handle` is the full orchestration (fan-out + synthesis). One roundtable per job. 10-min tick; typically triggered immediately via the route enqueueing.

---

## 4. Components

| kind | path | new? | purpose |
|---|---|---|---|
| API route | `src/mastisk/routes/roundtable_route.py` | new | POST start, GET detail, GET list, POST `/save-synthesis-as-note` |
| Agent | `src/mastisk/agents/roundtable.py` | new | Orchestrator: fan out to bridges, collect, synthesize |
| Bridge | `src/mastisk/bridges/codex_bridge.py` | new | Subprocess wrapper around `codex` CLI |
| Bridge | `src/mastisk/bridges/gemini_bridge.py` | new | Subprocess wrapper around `gemini` CLI |
| Bridge | `src/mastisk/bridges/claude_bridge.py` | edit | Add a `run_claude_with_system(prompt, system)` helper if not already present |
| DB schema | `src/mastisk/db/schema.sql` | edit | `roundtables` + `roundtable_perspectives` tables |
| CLI | `src/mastisk/cli.py` | edit | `mastisk roundtable [text]` (optional — nice-to-have) |
| Frontend | `frontend/src/components/RoundtableView.tsx`, `RoundtableButton.tsx`, `RoundtablesListView.tsx` | new | Detail view, trigger button, list view |
| Frontend | `frontend/src/types.ts`, `router.ts`, `api.ts`, `App.tsx`, `Titlebar.tsx`, `Sidebar.tsx` | edit | Wire new views |
| Settings | `src/mastisk/settings.py` | edit | `RoundtableSettings` under `Settings.roundtable` |

---

## 5. Database Schema

Append to `src/mastisk/db/schema.sql`:

```sql
-- ─────────────────────────────── Roundtables ───────────────────────────────
-- A roundtable is one fan-out of a prompt to multiple LLMs + one synthesis.
-- Fully DB-stored (no filesystem artifact), because perspectives are transient
-- research output, not canonical user content.

CREATE TABLE IF NOT EXISTS roundtables (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  input_type     TEXT NOT NULL,          -- 'note' | 'article' | 'prompt'
  input_ref      TEXT NOT NULL,          -- note_id (stringified) | article_id | '' for free prompt
  prompt         TEXT NOT NULL,          -- the final prompt sent to each backend
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  synthesis      TEXT,                   -- Claude's integration paragraph
  synthesis_model TEXT,                  -- which model produced the synthesis (usually 'claude')
  error          TEXT,                   -- if status='failed', the error message
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at    DATETIME,
  saved_as_note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_roundtables_created ON roundtables(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_roundtables_status ON roundtables(status) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_roundtables_input ON roundtables(input_type, input_ref);

-- One row per backend per roundtable.
CREATE TABLE IF NOT EXISTS roundtable_perspectives (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  roundtable_id  INTEGER NOT NULL REFERENCES roundtables(id) ON DELETE CASCADE,
  backend        TEXT NOT NULL,          -- 'claude' | 'codex' | 'gemini' | 'ollama'
  model          TEXT,                   -- e.g. 'claude-sonnet-4-6', 'llama3.1:8b'
  content        TEXT,                   -- the perspective text (null if the backend failed)
  error          TEXT,                   -- null if succeeded; error message if failed
  latency_ms     INTEGER,                -- wall-clock ms for this backend's call
  started_at     DATETIME,
  finished_at    DATETIME
);

CREATE INDEX IF NOT EXISTS idx_roundtable_perspectives_rt ON roundtable_perspectives(roundtable_id);
```

---

## 6. API Surface

```
POST   /api/roundtables
       body: {"input_type": "note"|"article"|"prompt", "input_ref": "...", "prompt": "..."}
       → 202, {"id": N, "status": "pending"}
       Enqueues a roundtable job; does NOT block on the fan-out.

GET    /api/roundtables?limit=50
       → 200, [{id, input_type, input_ref, status, created_at, synthesis_preview}, ...]

GET    /api/roundtables/:id
       → 200, full roundtable + perspectives array (each with backend, model, content/error, latency_ms)

POST   /api/roundtables/:id/save-as-note
       body: {}
       → 201, {"note_id": M, "slug": "..."}
       Writes the synthesis into vault/_notes/inbox/ via the existing Phase 1 capture path.
       Sets roundtables.saved_as_note_id = M. Feeds the Notetaker pipeline on the next tick.
```

`POST /api/roundtables` validates the `input_type` and `input_ref`:
- `input_type='note'` → `input_ref` must be a stringified valid `note_id`; 404 if unknown.
- `input_type='article'` → `input_ref` must be a valid article id; 404 if unknown.
- `input_type='prompt'` → `input_ref` can be empty; `prompt` must be non-empty.

---

## 7. Orchestrator Behavior

The `Roundtable` agent's `_handle(job)` runs for one roundtable_id.

**Flow:**

1. Load the roundtable row. Transition `status='running'`.
2. Build the effective prompt (see §8 for templates).
3. Fan out via `asyncio.gather` to all configured backends. Each backend call is wrapped so a failure records an error perspective but doesn't raise.
4. Wait for all to return (or time out at 120s per backend — configurable).
5. If ≥1 perspective succeeded: build synthesis prompt, call Claude (or Ollama fallback if Claude quota is out). Write synthesis.
6. Transition `status='done'` + `finished_at`. Emit `feed(verb='roundtable-done', obj=id, kind='roundtable')`.
7. If ALL perspectives failed: `status='failed'`, `error='all backends failed'`.

**Backend configuration (in `NotesSettings` → actually in a new `RoundtableSettings`):**

```python
class RoundtableSettings(BaseSettings):
    backends: list[str] = Field(default_factory=lambda: ["claude", "codex", "gemini", "ollama"])
    timeout_seconds: int = 120
    synthesis_model: str = "claude"   # 'claude' or 'ollama' (fallback)
    perspective_models: dict[str, str] = Field(default_factory=lambda: {
        "claude": "claude-sonnet-4-6",
        "codex": "gpt-5-codex",      # codex CLI default
        "gemini": "gemini-2.5-pro",
        "ollama": "llama3.1:8b",
    })
```

A backend is "available" if:
- `claude`: `claude` binary on PATH (check `settings.claude_cmd`).
- `codex`: `codex` binary on PATH.
- `gemini`: `gemini` binary on PATH.
- `ollama`: HTTP to `OLLAMA_LOCAL_URL` is reachable (existing `ollama_bridge` handles this).

A backend that's unavailable is skipped silently but recorded in `roundtable_perspectives` with `error='backend not available'`.

---

## 8. Prompt Templates

Each backend gets a prompt of this shape (constructed by the orchestrator):

```
You are one of several AI models consulted on a question. Give your OWN take — don't hedge, don't synthesize others' views, don't claim to speak for multiple models.

## About the user
{identity}

## Context
{context_block}

## Question
{user_prompt}

## Your response
Be specific, cite concrete mechanisms, and acknowledge uncertainty where real. 200-500 words. Plain prose, no fenced code unless code is genuinely the answer.
```

`{context_block}` is:
- If `input_type='note'`: the note's body + classification + tags.
- If `input_type='article'`: article's title + summary + body_md (truncated to 4000 chars if longer).
- If `input_type='prompt'`: empty.

`{user_prompt}` is either the raw user input or a derived "what's most interesting about this?" question if `prompt` wasn't supplied.

**Synthesis prompt** (sent only to Claude, after all perspectives return):

```
Four models were asked the same question. Their answers are below. Write a single synthesis paragraph that:
- Names where they agree.
- Names where they disagree, with who said what.
- Identifies the strongest single insight across the set.
- Flags anything suspicious (hallucination, surface-level reasoning) by backend name.

Keep it under 250 words. Plain prose.

## Question
{user_prompt}

## Perspectives
### Claude
{claude_content}

### Codex
{codex_content}

### Gemini
{gemini_content}

### Ollama
{ollama_content}
```

---

## 9. CLI Bridges

### `codex_bridge.py`

Wraps the `codex` CLI (same pattern as `claude_bridge`):

```python
async def run_codex(prompt: str, model: str | None = None) -> dict:
    """Invoke the codex CLI non-interactively. Returns {'text': str, 'raw': str}."""
    cmd = ["codex", "exec", "--full-auto"]
    if model:
        cmd += ["--model", model]
    cmd.append(prompt)
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise CodexError(stderr.decode("utf-8", errors="replace")[:500])
    return {"text": stdout.decode("utf-8"), "raw": stdout.decode("utf-8")}
```

### `gemini_bridge.py`

Same shape, different binary:

```python
async def run_gemini(prompt: str, model: str | None = None) -> dict:
    cmd = ["gemini"]
    if model:
        cmd += ["--model", model]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate(prompt.encode("utf-8"))
    if proc.returncode != 0:
        raise GeminiError(stderr.decode("utf-8", errors="replace")[:500])
    return {"text": stdout.decode("utf-8"), "raw": stdout.decode("utf-8")}
```

Both bridges define their own `*Error` class so the orchestrator can distinguish.

**Verification of CLI signatures before implementation:** the spec assumes `codex exec --full-auto <prompt>` and `gemini --model X` with stdin prompt. Implementer should verify by running `codex --help` / `gemini --help` on the user's machine before finalizing these — if the actual invocations differ, adjust.

---

## 10. Frontend

### New view: `RoundtableView`

Shows:
- The originating input (linked if note/article)
- Each perspective as a card (backend name + model + latency + content or error)
- The synthesis paragraph (highlighted)
- Actions: "Save synthesis as note", "Re-run"

### New button: `RoundtableButton`

Embedded in `NoteView.tsx` and `ArticleView.tsx` (later). Clicking it POSTs `/api/roundtables` and navigates to the new session. While status is `pending`/`running`, shows a progress state.

### Polling vs SSE

Perspectives take 10-30s each. Poll `GET /api/roundtables/:id` every 2s while status is `pending`/`running`. Stop on `done`/`failed`. No SSE for v1.

### List view: `RoundtablesListView`

Shows recent roundtables with their inputs + synthesis preview + click-through.

### Routing

- `/roundtables` → list
- `/roundtables/:id` → detail

---

## 11. Error Handling

| case | handling |
|---|---|
| Zero backends available | POST returns 422 with message listing what to install. |
| One backend binary missing | Skip silently; record perspective row with `error='backend not available'`. |
| Backend hangs past timeout | Kill subprocess; record `error='timeout after Ns'`. |
| Claude quota exhausted | Record Claude perspective as `error='quota'`; synthesis falls back to Ollama. |
| All backends fail | Synthesis skipped; `status='failed'`. User can re-run. |
| User hits "Save as note" twice | Second call idempotent — returns the existing note_id. |
| Synthesis call fails | Keep perspectives; set `synthesis=null`, `synthesis_model=null`, leave roundtable in `status='done'` (user sees raw perspectives only). |
| Input note/article deleted mid-run | Orchestrator completes (uses cached prompt text); on save-as-note, the new note has no back-link to the deleted source. |

---

## 12. Testing Strategy

Mocks for all four bridges (don't spend LLM calls in tests). One integration test that exercises the full fan-out with mocked bridges.

- `test_roundtable_agent.py`:
  - Mock all four bridges → roundtable completes with 4 perspectives + synthesis.
  - Mock one bridge to raise → the other three still succeed; the failing one has `error` recorded.
  - Mock all four to fail → `status='failed'`.
  - Backend availability check (binary missing → skip).
- `test_roundtable_route.py`:
  - POST with `input_type='note'` and unknown id → 404.
  - POST with valid note → 202 + row inserted.
  - GET detail returns perspectives.
  - POST save-as-note → creates a note with the synthesis as body, sets `saved_as_note_id`.
  - POST save-as-note twice → idempotent.
- `test_codex_bridge.py` / `test_gemini_bridge.py`:
  - Mock `asyncio.create_subprocess_exec` to return fake stdout/stderr; verify the command shape.

---

## 13. Compounding Properties

- ✅ Roundtable synthesis can become a note (via `POST /save-as-note`) → feeds the Notes pipeline → can be classified + escalated back into wiki articles.
- ✅ Roundtables on an article link back via `input_ref` → article detail can show "This article has been discussed in N roundtables".
- ✅ Future GitHub Agent can trigger roundtables automatically on its repo-generated ideas (treats a GH agent idea like a prompt).

**Anti-compounding avoided:**
- No output-only artifact: perspectives + synthesis have a downstream consumer (the note).
- No terminal UI: every roundtable is navigable, referenced, re-runnable.

---

## 14. Implementation Phases

1. **Phase A — Schema + bridges.** `roundtables` + `roundtable_perspectives` tables; `codex_bridge`, `gemini_bridge`; unit tests for each bridge.
2. **Phase B — Orchestrator agent.** `Roundtable` agent with fan-out + synthesis; scheduler registration; unit tests mocking bridges.
3. **Phase C — API routes.** POST/GET/save-as-note endpoints; tests.
4. **Phase D — PWA.** `RoundtableView`, button on note/article detail, list view, routing, polling.
5. **Phase E — CLI + README.** `mastisk roundtable` command; docs.

Each phase is a shippable PR.

---

## 15. Open Questions / Known Unknowns

- **CLI argument shapes.** The `codex` + `gemini` invocations are assumed; implementer must verify with `--help` on the user's machine. If a CLI requires a different invocation (e.g., `codex run` vs `codex exec`), adjust silently.
- **Context sizing.** Truncation at 4000 chars for article body is a guess. Should be configurable via `RoundtableSettings.context_max_chars` default 4000.
- **Synthesis always Claude?** Spec says yes; a fallback to Ollama only if Claude unavailable. Could be configurable, but simpler as "Claude first, Ollama fallback" rule.
- **Do we need a separate "ask the roundtable" freeform view?** Phase D includes a button on note/article detail; a dedicated `/roundtable/new` page with a textarea for free prompts is a nice-to-have after those two.
- **Rate limiting.** No per-user rate limit on POST since mastisk is single-user. But a backend-specific cap (e.g., ≤ N roundtables/day) would prevent quota blowups. Not in v1.

These don't block implementation.

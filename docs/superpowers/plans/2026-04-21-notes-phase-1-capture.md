# Notes Subsystem — Phase 1: Capture & Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship end-to-end note capture: PWA + CLI + vault-drop → file in `vault/_notes/inbox/` → DB row → listable/viewable/deletable via API and PWA. **No classification yet** (Phase 2 plan).

**Architecture:** Vault-native markdown (iCloud canonical), SQLite index derived. FastAPI route writes atomically via `NamedTemporaryFile` + `os.rename`. PWA extends the existing `view`-switch pattern in `App.tsx` (no new router). Tests hit a real in-memory SQLite via an overridable `connect(path=...)`.

**Tech Stack:** Python 3.11+, FastAPI, sqlite3 (stdlib), pydantic-settings, typer, python-slugify, React 18 + Vite, existing mastisk patterns.

**Spec reference:** `docs/superpowers/specs/2026-04-21-notes-subsystem-design.md`. Sections cited inline.

---

## Scope

**In this plan (Phase 1 only):**
- Schema additions: `notes`, `note_links`, `note_escalations` tables (Phase 1 only uses `notes`, but creating all three now avoids a second migration when Phase 2 lands)
- `articles.source_note_id` column via `_run_migrations`
- Vault layout: `vault/_notes/inbox/`, `vault/_notes/YYYY-MM-DD/`, `vault/_notes/daily/`
- Python: `routes/notes.py`, note query helpers in `queries.py`, path helpers in `paths.py`, config in `settings.py`, CLI `mastisk note`
- Frontend: `NoteCaptureModal`, `NotesView`, `NoteView`, Titlebar "+" button, App.tsx view-switch entries, types/router/api-client wiring
- Tests: DB query tests, API route tests

**Deferred to later plans:**
- Notetaker agent, classification, Ollama integration, frontmatter writing, note_links insertion (Phase 2 plan)
- Daily digest generation (Phase 3 plan)
- Escalator agent, Claude research stubs, auto-rule, retry (Phase 4-5 plan)
- `vault_integrity` scheduler job for tombstones on externally-deleted notes (Phase 6 plan)
- Service-worker offline capture queue (flagged in spec §15; ship online-only first)

---

## File Structure

### Backend (new)
- `tests/__init__.py` — empty
- `tests/conftest.py` — shared pytest fixtures (isolated DB + tmp vault)
- `tests/test_notes_queries.py` — DB query unit tests
- `tests/test_notes_route.py` — API route integration tests
- `src/mastisk/routes/notes.py` — FastAPI router for `/api/notes*`

### Backend (modified)
- `src/mastisk/db/schema.sql` — append notes/note_links/note_escalations tables + indexes
- `src/mastisk/db/queries.py` — add `_add_column_if_missing` call for `source_note_id`; add note query helpers
- `src/mastisk/paths.py` — add `notes_dir()`, `notes_inbox_dir()`, `notes_daily_dir()`; extend `ensure_dirs()`
- `src/mastisk/settings.py` — add `NotesSettings` nested under `Settings`
- `src/mastisk/app.py` — import and register `notes.router`
- `src/mastisk/cli.py` — add `note` subcommand

### Frontend (new)
- `frontend/src/components/NoteCaptureModal.tsx` — capture modal (pattern from `AskDrawer.tsx`)
- `frontend/src/components/NotesView.tsx` — list of all notes
- `frontend/src/components/NoteView.tsx` — single note detail

### Frontend (modified)
- `frontend/src/types.ts` — add `Note` interface; extend `View` union with `'notes' | 'note'`
- `frontend/src/router.ts` — add `notes` and `note` routes (with id param for `note`)
- `frontend/src/api.ts` — add `notes.create`, `notes.list`, `notes.get`, `notes.delete`
- `frontend/src/components/Titlebar.tsx` — add "+" capture button
- `frontend/src/App.tsx` — handle new views in switch; render `NoteCaptureModal` at app level

---

## Tasks

### Task 1: Tests scaffold

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`

- [ ] **Step 1: Create `tests/__init__.py`** (empty file so pytest discovers the package)

```python
```

- [ ] **Step 2: Create `tests/conftest.py` with isolated-DB and tmp-vault fixtures**

```python
"""Shared pytest fixtures. Isolates DB + vault per test so nothing touches the real ~/Library paths."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def vault_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point MASTISK_VAULT at a tmp dir; clear the lru_cache so it takes effect."""
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setenv("MASTISK_VAULT", str(vault))
    # Clear cached path resolvers
    from mastisk import paths
    paths.vault_dir.cache_clear()
    paths.data_dir.cache_clear()
    return vault


@pytest.fixture
def data_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("MASTISK_HOME", str(data))
    from mastisk import paths
    paths.data_dir.cache_clear()
    paths.vault_dir.cache_clear()
    return data


@pytest.fixture
def db(vault_tmp: Path, data_tmp: Path) -> sqlite3.Connection:
    """Fresh SQLite at data_tmp/mastisk.db, schema applied."""
    from mastisk.db.queries import connect, init_schema
    conn = connect()  # uses db_path() which reads data_dir() → data_tmp
    init_schema(conn)
    yield conn
    conn.close()
```

- [ ] **Step 3: Verify pytest discovers the tests directory**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/ --collect-only`
Expected: `collected 0 items` (no tests yet; but no errors).

- [ ] **Step 4: Commit**

```bash
git add tests/__init__.py tests/conftest.py
git commit -m "tests: scaffold pytest with isolated DB + vault fixtures"
```

---

### Task 2: Schema additions + migration

**Files:**
- Modify: `src/mastisk/db/schema.sql` (append)
- Modify: `src/mastisk/db/queries.py` (one line in `_run_migrations`)

- [ ] **Step 1: Write the failing test** — `tests/test_notes_queries.py`

```python
"""Tests for note-related DB queries."""
from __future__ import annotations


def test_schema_has_note_tables(db):
    """After init_schema, notes/note_links/note_escalations tables exist."""
    tables = {
        r["name"]
        for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "notes" in tables
    assert "note_links" in tables
    assert "note_escalations" in tables


def test_migration_adds_source_note_id_to_articles(db):
    """The _run_migrations step adds source_note_id to articles."""
    cols = {r[1] for r in db.execute("PRAGMA table_info(articles)").fetchall()}
    assert "source_note_id" in cols
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_queries.py -v`
Expected: `FAILED` — `notes` not in tables.

- [ ] **Step 3: Append the three tables + indexes to `db/schema.sql`**

Append at end of file (before any trailing triggers section — in the current file, after the last `CREATE TRIGGER` is fine; read the file to confirm the last meaningful line):

```sql
-- ─────────────────────────────── Notes ───────────────────────────────
-- User-authored content. File in vault/_notes/ is the source of truth;
-- this row is a derived index. See docs/superpowers/specs/2026-04-21-notes-subsystem-design.md

CREATE TABLE IF NOT EXISTS notes (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug                        TEXT UNIQUE NOT NULL,
    path                        TEXT UNIQUE NOT NULL,
    body                        TEXT NOT NULL,
    body_sha256                 TEXT NOT NULL,
    source                      TEXT NOT NULL,            -- 'pwa' | 'cli' | 'file'
    created_at                  DATETIME NOT NULL,
    classified_at               DATETIME,
    classification              TEXT,
    summary                     TEXT,
    confidence                  REAL,
    tags_json                   TEXT DEFAULT '[]',
    escalation_state            TEXT NOT NULL DEFAULT 'none',
    escalation_trigger          TEXT,
    escalation_article_id       TEXT REFERENCES articles(id) ON DELETE SET NULL,
    escalation_retry_count      INTEGER NOT NULL DEFAULT 0,
    escalation_next_attempt_at  DATETIME,
    deleted_at                  DATETIME
);

CREATE INDEX IF NOT EXISTS idx_notes_created_at         ON notes(created_at);
CREATE INDEX IF NOT EXISTS idx_notes_classified_at      ON notes(classified_at);
CREATE INDEX IF NOT EXISTS idx_notes_escalation_pending ON notes(escalation_state, escalation_next_attempt_at)
    WHERE escalation_state IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_notes_deleted_at         ON notes(deleted_at);

CREATE TABLE IF NOT EXISTS note_links (
    note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    article_id  TEXT    NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    rank        INTEGER NOT NULL,
    PRIMARY KEY (note_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_note_links_article ON note_links(article_id);

CREATE TABLE IF NOT EXISTS note_escalations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id         INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    triggered_at    DATETIME NOT NULL,
    trigger         TEXT NOT NULL,
    result          TEXT NOT NULL,
    stub_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
    error           TEXT,
    model           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_escalations_note         ON note_escalations(note_id);
CREATE INDEX IF NOT EXISTS idx_note_escalations_triggered_at ON note_escalations(triggered_at);
```

- [ ] **Step 4: Add `source_note_id` migration in `queries.py::_run_migrations`**

Edit `src/mastisk/db/queries.py` — add ONE line to the existing `_run_migrations` function:

```python
def _run_migrations(conn: sqlite3.Connection) -> None:
    """Idempotent column additions for pre-existing DBs. CREATE TABLE IF NOT
    EXISTS handles fresh installs; this handles upgrade-in-place."""
    _add_column_if_missing(conn, "articles", "hero_image_url", "TEXT")
    _add_column_if_missing(conn, "sources", "hero_image_url", "TEXT")
    _add_column_if_missing(conn, "sources", "media_json", "TEXT")
    _add_column_if_missing(
        conn, "articles", "source_note_id",
        "INTEGER REFERENCES notes(id) ON DELETE SET NULL",
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_queries.py -v`
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mastisk/db/schema.sql src/mastisk/db/queries.py tests/test_notes_queries.py
git commit -m "notes: schema tables (notes, note_links, note_escalations) + articles.source_note_id"
```

---

### Task 3: Path helpers + settings

**Files:**
- Modify: `src/mastisk/paths.py`
- Modify: `src/mastisk/settings.py`

- [ ] **Step 1: Write the failing test** — append to `tests/test_notes_queries.py`

```python
def test_notes_dir_helpers(vault_tmp):
    from mastisk.paths import notes_dir, notes_inbox_dir, notes_daily_dir, ensure_dirs
    ensure_dirs()
    assert notes_dir().exists()
    assert notes_inbox_dir().exists()
    assert notes_daily_dir().exists()
    assert notes_dir() == vault_tmp / "_notes"
    assert notes_inbox_dir() == vault_tmp / "_notes" / "inbox"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_queries.py::test_notes_dir_helpers -v`
Expected: FAIL — `cannot import name 'notes_dir'`.

- [ ] **Step 3: Add path helpers to `src/mastisk/paths.py`**

Insert after `self_dir()`:

```python
def notes_dir() -> Path:
    return vault_dir() / "_notes"


def notes_inbox_dir() -> Path:
    return notes_dir() / "inbox"


def notes_daily_dir() -> Path:
    return notes_dir() / "daily"
```

Extend `ensure_dirs()` — add these three entries to the list inside it:

```python
        notes_dir(),
        notes_inbox_dir(),
        notes_daily_dir(),
```

- [ ] **Step 4: Add `NotesSettings` to `src/mastisk/settings.py`**

Add before the `Settings` class:

```python
class NotesSettings(BaseSettings):
    """Config for the notes subsystem. See docs/superpowers/specs/2026-04-21-notes-subsystem-design.md §8."""
    classify_stable_mtime_seconds: int = 30
    auto_escalate_cap: int = 20
    auto_escalate_min_confidence: float = 0.7
    auto_escalate_min_length: int = 80
    auto_escalate_classifications: list[str] = Field(default_factory=lambda: ["idea", "question"])
    dedup_hours: int = 24
    dedup_similarity_threshold: float = 0.85
    claude_retry_count: int = 2
    claude_retry_backoff_mins: list[int] = Field(default_factory=lambda: [30, 60])
    notetaker_model: str = "llama3.1:8b"
    escalator_model: str = "claude-sonnet-4-6"
    notetaker_concurrency: int = 4
```

Add to the `Settings` class, near `budget: AgentBudget`:

```python
    notes: NotesSettings = Field(default_factory=NotesSettings)
```

- [ ] **Step 5: Run tests to verify path helpers pass**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_queries.py -v`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mastisk/paths.py src/mastisk/settings.py tests/test_notes_queries.py
git commit -m "notes: path helpers (notes_dir, inbox, daily) + NotesSettings"
```

---

### Task 4: `insert_note` query with slug-collision retry

**Files:**
- Modify: `src/mastisk/db/queries.py` (append note helpers section)
- Modify: `tests/test_notes_queries.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_notes_queries.py`:

```python
from datetime import datetime


def test_insert_note_basic(db):
    from mastisk.db.queries import insert_note
    note_id = insert_note(
        db,
        slug="143522-hello-world",
        path="_notes/inbox/143522-hello-world.md",
        body="hello world\n\nthis is a note",
        source="cli",
        created_at=datetime(2026, 4, 21, 14, 35, 22),
    )
    assert isinstance(note_id, int) and note_id > 0
    row = db.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    assert row["slug"] == "143522-hello-world"
    assert row["classification"] is None
    assert row["escalation_state"] == "none"
    assert row["body_sha256"] != ""  # should be computed


def test_insert_note_slug_collision_appends_suffix(db):
    """Two notes with the same slug within the same second → second gets '-2' suffix."""
    from mastisk.db.queries import insert_note
    ts = datetime(2026, 4, 21, 14, 35, 22)
    id1 = insert_note(db, slug="143522-foo", path="_notes/inbox/143522-foo.md",
                      body="first", source="cli", created_at=ts)
    id2 = insert_note(db, slug="143522-foo", path="_notes/inbox/143522-foo-2.md",
                      body="second", source="cli", created_at=ts)
    slug1 = db.execute("SELECT slug FROM notes WHERE id=?", (id1,)).fetchone()["slug"]
    slug2 = db.execute("SELECT slug FROM notes WHERE id=?", (id2,)).fetchone()["slug"]
    assert slug1 == "143522-foo"
    assert slug2 == "143522-foo-2"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_queries.py -v`
Expected: two new tests FAIL with `cannot import name 'insert_note'`.

- [ ] **Step 3: Add the helper to `src/mastisk/db/queries.py`**

Append after the existing helper sections (e.g., after `ensure_stub_article`):

```python
# ─────────────────────────────── Notes ───────────────────────────────

def insert_note(
    conn: sqlite3.Connection,
    *,
    slug: str,
    path: str,
    body: str,
    source: str,
    created_at: datetime,
) -> int:
    """Insert a new note. On UNIQUE-slug collision, retry with -2, -3, ... up to -99.

    The caller has already picked a slug based on timestamp + first-line slugify;
    collisions are vanishingly rare (same-second capture). See spec §5.
    """
    import hashlib
    body_sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
    base_slug = slug
    for attempt in range(1, 100):
        try_slug = base_slug if attempt == 1 else f"{base_slug}-{attempt}"
        try_path = path if attempt == 1 else path.replace(f"{base_slug}.md", f"{base_slug}-{attempt}.md")
        try:
            cur = conn.execute(
                """INSERT INTO notes (slug, path, body, body_sha256, source, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (try_slug, try_path, body, body_sha, source, created_at.isoformat()),
            )
            return cur.lastrowid or 0
        except sqlite3.IntegrityError as e:
            msg = str(e).lower()
            if "unique" in msg and ("slug" in msg or "path" in msg):
                continue
            raise
    raise RuntimeError(f"insert_note: exhausted slug collision retries for {base_slug!r}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_queries.py -v`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mastisk/db/queries.py tests/test_notes_queries.py
git commit -m "notes: insert_note query with slug-collision retry"
```

---

### Task 5: `get_note`, `list_notes`, `soft_delete_note` queries

**Files:**
- Modify: `src/mastisk/db/queries.py` (extend notes section)
- Modify: `tests/test_notes_queries.py` (append)

- [ ] **Step 1: Write failing tests**

Append to `tests/test_notes_queries.py`:

```python
def test_get_note_returns_row(db):
    from mastisk.db.queries import insert_note, get_note
    ts = datetime(2026, 4, 21, 14, 35, 22)
    note_id = insert_note(db, slug="a", path="_notes/inbox/a.md",
                          body="x", source="pwa", created_at=ts)
    row = get_note(db, note_id)
    assert row is not None
    assert row["slug"] == "a"
    assert get_note(db, 99999) is None


def test_list_notes_ordering_and_limit(db):
    from mastisk.db.queries import insert_note, list_notes
    for i in range(5):
        insert_note(db, slug=f"n{i}", path=f"_notes/inbox/n{i}.md",
                    body=f"body {i}", source="cli",
                    created_at=datetime(2026, 4, 21, 14, 35, i))
    rows = list_notes(db, limit=3)
    assert len(rows) == 3
    # Most recent first
    assert rows[0]["slug"] == "n4"
    assert rows[-1]["slug"] == "n2"


def test_list_notes_excludes_deleted(db):
    from mastisk.db.queries import insert_note, soft_delete_note, list_notes
    ts = datetime(2026, 4, 21, 14, 35, 22)
    id1 = insert_note(db, slug="keep", path="_notes/inbox/keep.md",
                      body="k", source="cli", created_at=ts)
    id2 = insert_note(db, slug="drop", path="_notes/inbox/drop.md",
                      body="d", source="cli", created_at=ts)
    soft_delete_note(db, id2)
    slugs = [r["slug"] for r in list_notes(db)]
    assert "keep" in slugs
    assert "drop" not in slugs


def test_soft_delete_sets_tombstone(db):
    from mastisk.db.queries import insert_note, soft_delete_note, get_note
    ts = datetime(2026, 4, 21, 14, 35, 22)
    note_id = insert_note(db, slug="x", path="_notes/inbox/x.md",
                          body="x", source="cli", created_at=ts)
    soft_delete_note(db, note_id)
    # get_note still returns it (so escalated articles can back-reference), but deleted_at is set
    row = get_note(db, note_id)
    assert row is not None
    assert row["deleted_at"] is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_queries.py -v`
Expected: four new tests FAIL.

- [ ] **Step 3: Add helpers to `src/mastisk/db/queries.py`**

Append to the Notes section:

```python
def get_note(conn: sqlite3.Connection, note_id: int) -> dict | None:
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    return dict(row) if row else None


def list_notes(
    conn: sqlite3.Connection,
    *,
    limit: int = 50,
    before_id: int | None = None,
    classification: str | None = None,
) -> list[dict]:
    """List notes, newest first. Excludes tombstoned rows."""
    q = "SELECT * FROM notes WHERE deleted_at IS NULL"
    params: list[Any] = []
    if before_id is not None:
        q += " AND id < ?"
        params.append(before_id)
    if classification is not None:
        q += " AND classification = ?"
        params.append(classification)
    q += " ORDER BY created_at DESC, id DESC LIMIT ?"
    params.append(limit)
    return [dict(r) for r in conn.execute(q, params).fetchall()]


def soft_delete_note(conn: sqlite3.Connection, note_id: int) -> None:
    conn.execute(
        "UPDATE notes SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
        (note_id,),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_queries.py -v`
Expected: all tests PASS (7 total in this file now).

- [ ] **Step 5: Commit**

```bash
git add src/mastisk/db/queries.py tests/test_notes_queries.py
git commit -m "notes: get_note / list_notes / soft_delete_note queries"
```

---

### Task 6: `POST /api/notes` — capture endpoint

**Files:**
- Create: `src/mastisk/routes/notes.py`
- Create: `tests/test_notes_route.py`

- [ ] **Step 1: Write failing tests** — `tests/test_notes_route.py`

```python
"""Integration tests for /api/notes routes."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(vault_tmp, data_tmp, db):
    """Build the FastAPI app with tmp paths in effect. `db` runs first so schema is applied."""
    # Reload settings in case a previous test cached them
    from mastisk.settings import reload_settings
    reload_settings()
    from mastisk.app import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c


def test_post_notes_creates_file_and_row(client, vault_tmp):
    r = client.post("/api/notes", json={"text": "first thought", "source": "pwa"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] > 0
    assert body["slug"].endswith("first-thought") or "first" in body["slug"]
    # File should exist on disk in inbox/
    file_path = vault_tmp / body["path"]
    assert file_path.exists()
    assert "first thought" in file_path.read_text()


def test_post_notes_rejects_empty_text(client):
    r = client.post("/api/notes", json={"text": "   ", "source": "pwa"})
    assert r.status_code == 422


def test_post_notes_uses_cli_source(client):
    r = client.post("/api/notes", json={"text": "from cli", "source": "cli"})
    assert r.status_code == 201
    note_id = r.json()["id"]
    detail = client.get(f"/api/notes/{note_id}")
    # detail endpoint is Task 7; but we can still inspect via DB
    from mastisk.db.queries import connect, get_note
    with connect() as conn:
        row = get_note(conn, note_id)
        assert row["source"] == "cli"
```

*Note: the third test asserts behavior covered by Task 7's endpoint. That test will start passing once Task 7 lands; for now skip if fails on `client.get`.*

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_route.py -v`
Expected: FAIL — 404 on `/api/notes` (route not registered).

- [ ] **Step 3: Create `src/mastisk/routes/notes.py`**

```python
"""Notes API — capture, list, detail, delete."""
from __future__ import annotations

import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from slugify import slugify

from mastisk.db import queries as q
from mastisk.db.queries import connect
from mastisk.paths import notes_inbox_dir, vault_dir

router = APIRouter(prefix="/api/notes", tags=["notes"])


class CaptureRequest(BaseModel):
    text: str = Field(min_length=1)
    source: Literal["pwa", "cli"] = "pwa"

    @field_validator("text")
    @classmethod
    def _non_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must be non-blank")
        return v


def derive_slug(body: str, ts: datetime) -> str:
    """`<HHMMSS>-<slugified first 60 chars>`. See spec §5."""
    first_line = body.strip().splitlines()[0] if body.strip() else "note"
    slug_part = slugify(first_line[:60])[:40] or "note"
    return f"{ts.strftime('%H%M%S')}-{slug_part}"


def atomic_write(target: Path, content: str) -> None:
    """Write `content` to `target` via tempfile + rename. Avoids half-synced files on iCloud."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".tmp", dir=target.parent
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.rename(tmp_path, target)
    except Exception:
        Path(tmp_path).unlink(missing_ok=True)
        raise


@router.post("", status_code=201)
async def capture_note(req: CaptureRequest) -> dict:
    ts = datetime.now().astimezone()
    slug = derive_slug(req.text, ts)
    filename = f"{slug}.md"
    inbox = notes_inbox_dir()
    target = inbox / filename
    atomic_write(target, req.text)
    rel_path = str(target.relative_to(vault_dir()))
    with connect() as conn:
        note_id = q.insert_note(
            conn,
            slug=slug,
            path=rel_path,
            body=req.text,
            source=req.source,
            created_at=ts,
        )
    # If collision retry renamed the slug, the file name we wrote may diverge
    # from what ended up in the DB. Reconcile: move the file to match the DB.
    with connect() as conn:
        row = q.get_note(conn, note_id)
    actual_path = vault_dir() / row["path"]
    if actual_path != target:
        target.rename(actual_path)
    return {
        "id": note_id,
        "slug": row["slug"],
        "path": row["path"],
        "created_at": row["created_at"],
    }
```

- [ ] **Step 4: Register the router in `src/mastisk/app.py`**

Find the existing import block that lists route modules. Append `notes`:

```python
from mastisk.routes import (
    articles, artifacts_route, ask, digest_route, feed_route, graph_route,
    listen_route, notes, open_questions_route, search, settings_route,
    signals_route, sources_route, stats_route, synthesis_route, vault_route,
)
```

Find the block inside `create_app()` that calls `app.include_router(...)` for each imported module. Add `app.include_router(notes.router)` following the existing pattern.

- [ ] **Step 5: Run tests to verify POST passes**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_route.py::test_post_notes_creates_file_and_row tests/test_notes_route.py::test_post_notes_rejects_empty_text -v`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mastisk/routes/notes.py src/mastisk/app.py tests/test_notes_route.py
git commit -m "notes: POST /api/notes capture endpoint (atomic file write + DB insert)"
```

---

### Task 7: `GET /api/notes` list + `GET /api/notes/:id` detail

**Files:**
- Modify: `src/mastisk/routes/notes.py`
- Modify: `tests/test_notes_route.py`

- [ ] **Step 1: Write failing tests** — append to `tests/test_notes_route.py`

```python
def test_list_notes_returns_most_recent_first(client):
    for i in range(3):
        client.post("/api/notes", json={"text": f"thought {i}"})
    r = client.get("/api/notes")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 3
    assert rows[0]["id"] > rows[1]["id"] > rows[2]["id"]


def test_list_notes_limit_param(client):
    for i in range(5):
        client.post("/api/notes", json={"text": f"thought {i}"})
    r = client.get("/api/notes?limit=2")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_get_note_detail(client):
    post = client.post("/api/notes", json={"text": "detailed thought"}).json()
    r = client.get(f"/api/notes/{post['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == post["id"]
    assert body["body"] == "detailed thought"
    assert body["classification"] is None
    assert body["source"] == "pwa"


def test_get_note_404_on_unknown(client):
    r = client.get("/api/notes/99999")
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_route.py -v`
Expected: FAIL with 404 or 422.

- [ ] **Step 3: Add the endpoints to `src/mastisk/routes/notes.py`**

Append below the POST handler:

```python
@router.get("")
async def list_notes_endpoint(
    limit: int = 50,
    before: int | None = None,
    classification: str | None = None,
) -> list[dict]:
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=422, detail="limit must be 1..500")
    with connect() as conn:
        rows = q.list_notes(conn, limit=limit, before_id=before, classification=classification)
    return [_note_summary(r) for r in rows]


@router.get("/{note_id}")
async def get_note_endpoint(note_id: int) -> dict:
    with connect() as conn:
        row = q.get_note(conn, note_id)
    if row is None:
        raise HTTPException(status_code=404, detail="note not found")
    return _note_detail(row)


def _note_summary(row: dict) -> dict:
    """Compact view for list endpoints — omits body + escalation plumbing."""
    import json
    return {
        "id": row["id"],
        "slug": row["slug"],
        "path": row["path"],
        "source": row["source"],
        "created_at": row["created_at"],
        "classified_at": row["classified_at"],
        "classification": row["classification"],
        "summary": row["summary"],
        "tags": json.loads(row["tags_json"]) if row["tags_json"] else [],
        "escalation_state": row["escalation_state"],
    }


def _note_detail(row: dict) -> dict:
    """Full view — includes body and all escalation fields."""
    return {
        **_note_summary(row),
        "body": row["body"],
        "body_sha256": row["body_sha256"],
        "confidence": row["confidence"],
        "escalation_trigger": row["escalation_trigger"],
        "escalation_article_id": row["escalation_article_id"],
        "escalation_retry_count": row["escalation_retry_count"],
        "deleted_at": row["deleted_at"],
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_route.py -v`
Expected: all tests PASS including the earlier `test_post_notes_uses_cli_source`.

- [ ] **Step 5: Commit**

```bash
git add src/mastisk/routes/notes.py tests/test_notes_route.py
git commit -m "notes: GET list + GET detail endpoints"
```

---

### Task 8: `DELETE /api/notes/:id` + `GET /api/notes/:id/file`

**Files:**
- Modify: `src/mastisk/routes/notes.py`
- Modify: `tests/test_notes_route.py`

- [ ] **Step 1: Write failing tests** — append to `tests/test_notes_route.py`

```python
def test_delete_note_tombstones_and_removes_file(client, vault_tmp):
    post = client.post("/api/notes", json={"text": "to delete"}).json()
    file_path = vault_tmp / post["path"]
    assert file_path.exists()

    r = client.delete(f"/api/notes/{post['id']}")
    assert r.status_code == 204
    # File is gone
    assert not file_path.exists()
    # Note excluded from list
    listing = client.get("/api/notes").json()
    assert all(n["id"] != post["id"] for n in listing)


def test_delete_idempotent(client):
    post = client.post("/api/notes", json={"text": "once"}).json()
    assert client.delete(f"/api/notes/{post['id']}").status_code == 204
    # Second delete: 404 (already gone from list view) OR 204 (idempotent). Either is OK; we pick 404 for clarity.
    r = client.delete(f"/api/notes/{post['id']}")
    assert r.status_code == 404


def test_get_note_file_returns_markdown(client):
    post = client.post("/api/notes", json={"text": "# heading\n\nbody here"}).json()
    r = client.get(f"/api/notes/{post['id']}/file")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert "# heading" in r.text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_route.py -v`
Expected: three new tests FAIL.

- [ ] **Step 3: Add endpoints to `src/mastisk/routes/notes.py`**

Append:

```python
from fastapi.responses import PlainTextResponse


@router.delete("/{note_id}", status_code=204)
async def delete_note_endpoint(note_id: int) -> None:
    with connect() as conn:
        row = q.get_note(conn, note_id)
        if row is None or row["deleted_at"] is not None:
            raise HTTPException(status_code=404, detail="note not found")
        q.soft_delete_note(conn, note_id)
    # Remove the vault file (best-effort; a missing file is not an error)
    file_path = vault_dir() / row["path"]
    try:
        file_path.unlink()
    except FileNotFoundError:
        pass


@router.get("/{note_id}/file", response_class=PlainTextResponse)
async def get_note_file_endpoint(note_id: int) -> PlainTextResponse:
    with connect() as conn:
        row = q.get_note(conn, note_id)
    if row is None or row["deleted_at"] is not None:
        raise HTTPException(status_code=404, detail="note not found")
    file_path = vault_dir() / row["path"]
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="note file missing")
    return PlainTextResponse(
        file_path.read_text(encoding="utf-8"), media_type="text/markdown"
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest tests/test_notes_route.py -v`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mastisk/routes/notes.py tests/test_notes_route.py
git commit -m "notes: DELETE + GET file endpoints"
```

---

### Task 9: CLI `mastisk note [TEXT]`

**Files:**
- Modify: `src/mastisk/cli.py`

- [ ] **Step 1: Locate the CLI's Typer app**

Read `src/mastisk/cli.py`. The top declares `app = typer.Typer(...)` and commands use `@app.command()`. The `note` command lives in this same file.

- [ ] **Step 2: Add the `note` command**

Add near the other `@app.command()` blocks (e.g., after `add-feed`):

```python
@app.command()
def note(
    text: str | None = typer.Argument(None, help="Note body. If omitted, $EDITOR opens."),
) -> None:
    """Capture a note. Writes to vault/_notes/inbox/ and indexes it in the DB.

    Examples:
        mastisk note "test-time compute is about spending inference cycles"
        mastisk note   # opens $EDITOR
    """
    import os
    import subprocess
    import tempfile

    from mastisk.paths import ensure_dirs

    ensure_dirs()

    if text is None:
        editor = os.environ.get("EDITOR", "vi")
        with tempfile.NamedTemporaryFile(mode="w+", suffix=".md", delete=False) as tf:
            tf.write("# Write your note here; save and quit to capture.\n\n")
            tf.flush()
            tmp_path = tf.name
        try:
            subprocess.run([editor, tmp_path], check=True)
            text = open(tmp_path).read()
            # Strip the instruction comment if untouched
            text = text.replace("# Write your note here; save and quit to capture.\n\n", "", 1).strip()
        finally:
            os.unlink(tmp_path)

    if not text or not text.strip():
        typer.secho("nothing to capture (empty note)", fg="yellow")
        raise typer.Exit(code=1)

    # Use the same code path as the API: call the router's capture logic directly.
    from datetime import datetime

    from mastisk.db import queries as q
    from mastisk.db.queries import connect
    from mastisk.paths import notes_inbox_dir, vault_dir
    from mastisk.routes.notes import atomic_write, derive_slug

    ts = datetime.now().astimezone()
    slug = derive_slug(text, ts)
    filename = f"{slug}.md"
    target = notes_inbox_dir() / filename
    atomic_write(target, text)
    rel_path = str(target.relative_to(vault_dir()))
    with connect() as conn:
        note_id = q.insert_note(
            conn, slug=slug, path=rel_path, body=text,
            source="cli", created_at=ts,
        )
        row = q.get_note(conn, note_id)
    # Reconcile filename if slug collision renamed
    actual_path = vault_dir() / row["path"]
    if actual_path != target:
        target.rename(actual_path)
    typer.secho(f"captured #{note_id}: {row['slug']}", fg="green")
```

- [ ] **Step 3: Smoke-test the CLI manually**

Run: `cd /Users/sushil/Code/mastisk && uv run mastisk note "integration test note from CLI"`
Expected output: `captured #N: <HHMMSS>-integration-test-note-from-cli`

Verify file exists: `ls ~/Library/Mobile\ Documents/com~apple~CloudDocs/Mastisk/vault/_notes/inbox/` (if iCloud vault active) or `$MASTISK_VAULT/_notes/inbox/`.

- [ ] **Step 4: Commit**

```bash
git add src/mastisk/cli.py
git commit -m "notes: mastisk note CLI (inline text or \$EDITOR)"
```

---

### Task 10: Frontend types + router + API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/router.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Extend `frontend/src/types.ts`**

Find the `View` type union (around line 200 per prior exploration). Extend:

```typescript
export type View =
  | 'digest' | 'article' | 'feed' | 'agents' | 'graph'
  | 'ingest' | 'open_questions' | 'queue' | 'lint' | 'settings' | 'mobile'
  | 'notes' | 'note';   // ← new
```

Add the `Note` interface (place near `Article`):

```typescript
export interface Note {
  id: number;
  slug: string;
  path: string;
  source: 'pwa' | 'cli' | 'file';
  created_at: string;
  classified_at: string | null;
  classification: string | null;   // null in Phase 1
  summary: string | null;
  tags: string[];
  escalation_state: string;
  // Detail-only:
  body?: string;
  body_sha256?: string;
  confidence?: number | null;
  escalation_trigger?: string | null;
  escalation_article_id?: string | null;
  escalation_retry_count?: number;
  deleted_at?: string | null;
}
```

- [ ] **Step 2: Extend `frontend/src/router.ts`**

The existing file defines `Route { view, articleId, date }`, `VIEW_PATHS`, `PATH_FOR_VIEW`, `parseRoute`, `routeToPath`, and `useRoute`. Apply these concrete edits:

**a) Extend the `Route` interface** (line 4-8):

```typescript
export interface Route {
  view: View;
  articleId: string | null;
  noteId: number | null;       // ← new
  date: string | null;
}
```

**b) Add `/notes` to `VIEW_PATHS`** (after `/settings`):

```typescript
  '/notes': 'notes',
```

**c) Add `notes` + `note` to `PATH_FOR_VIEW`**:

```typescript
  notes: '/notes',
  note: '/notes/',
```

**d) Add `/notes/:id` handling in `parseRoute`** — insert before the `VIEW_PATHS[pathname]` lookup:

```typescript
  if (pathname.startsWith('/notes/')) {
    const raw = pathname.slice('/notes/'.length).split('/')[0];
    const id = Number(raw);
    if (raw && Number.isFinite(id) && id > 0) {
      return { view: 'note', articleId: null, noteId: id, date: null };
    }
    return { view: 'notes', articleId: null, noteId: null, date: null };
  }
```

**e) Update every `Route` literal** in `parseRoute`, `navigate`, and `replace` to include `noteId: null` in the default shape. Specifically:

- Line 45: `{ view: 'article', articleId: ..., date: null }` → add `noteId: null,`
- Line 50: `{ view: 'digest', articleId: null, date: raw }` → add `noteId: null,`
- Line 53: `{ view: 'digest', articleId: null, date: null }` → add `noteId: null,`
- Line 56: `{ view, articleId: null, date: null }` → add `noteId: null,`
- Line 57: `{ view: 'digest', articleId: null, date: null }` → add `noteId: null,`
- Line 80 (inside `navigate`): `const next: Route = { view, articleId: null, date: null };` → add `noteId: null,`
- Line 89 (inside `replace`): same as line 80

**f) Handle `note` view in `routeToPath`** — insert before the final `return PATH_FOR_VIEW[view] ?? '/';`:

```typescript
  if (view === 'note' && arg) return `/notes/${arg}`;
```

**g) Handle `noteId` in `navigate` and `replace`** — inside each, after the existing `if (view === 'article' ...)` and `else if (view === 'digest' ...)` branches, add:

```typescript
    else if (view === 'note' && arg) next.noteId = Number(arg);
```

(Uses the same `arg: string` parameter; callers pass `String(noteId)`.)

- [ ] **Step 3: Extend `frontend/src/api.ts`**

Add to the `api` object export:

```typescript
notes: {
  create: (text: string): Promise<{ id: number; slug: string; path: string }> =>
    fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source: 'pwa' }),
    }).then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); }),

  list: (limit = 50): Promise<Note[]> =>
    fetch(`/api/notes?limit=${limit}`).then(r => r.json()),

  get: (id: number): Promise<Note> =>
    fetch(`/api/notes/${id}`).then(r => {
      if (r.status === 404) throw new Error('not found');
      return r.json();
    }),

  delete: (id: number): Promise<void> =>
    fetch(`/api/notes/${id}`, { method: 'DELETE' }).then(r => {
      if (!r.ok) throw new Error(`${r.status}`);
    }),
},
```

Import `Note` at the top: `import type { Note } from './types';`.

- [ ] **Step 4: Verify the frontend still builds**

Run: `cd /Users/sushil/Code/mastisk/frontend && npm run build`
Expected: build succeeds with no type errors. If type errors: match existing `api` export shape (it may be a `const api = { ... }` or a top-level namespace object).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/router.ts frontend/src/api.ts
git commit -m "notes(frontend): types + router + api client"
```

---

### Task 11: NoteCaptureModal component

**Files:**
- Create: `frontend/src/components/NoteCaptureModal.tsx`
- Modify: `frontend/src/components/Titlebar.tsx`

- [ ] **Step 1: Create `frontend/src/components/NoteCaptureModal.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  onCaptured?: (noteId: number) => void;
}

export function NoteCaptureModal({ open, onClose, onCaptured }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
      // Autofocus after the modal mounts
      setTimeout(() => ref.current?.focus(), 50);
    }
  }, [open]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) { setError('empty note'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api.notes.create(trimmed);
      onCaptured?.(res.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }, [text, onCaptured, onClose]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [submit, onClose]);

  if (!open) return null;

  return (
    <div
      className="note-capture-backdrop"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '10vh', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="note-capture-card"
        style={{
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 16, width: 'min(640px, 92vw)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 12, color: 'var(--fg-faint)', marginBottom: 8, fontFamily: 'var(--mono)' }}>
          capture note — ⌘↵ to save, esc to cancel
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          placeholder="what are you thinking?"
          rows={8}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'transparent', color: 'var(--fg)',
            border: '1px solid var(--border)', borderRadius: 4,
            padding: 10, fontFamily: 'var(--mono)', fontSize: 14,
            resize: 'vertical',
          }}
        />
        {error && <div style={{ color: 'var(--danger, crimson)', marginTop: 6, fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          <button onClick={onClose} disabled={busy}>cancel</button>
          <button onClick={submit} disabled={busy || !text.trim()}>
            {busy ? 'saving…' : 'save ⌘↵'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add a "+" button to `Titlebar.tsx`**

Read `frontend/src/components/Titlebar.tsx`. It exports a `Titlebar` component whose props include `onAsk`, `onTheme`, `onToggleSide`, `onToggleRail`, `onSearchClick` (per `App.tsx` call site). Add `onCapture: () => void` to the props interface.

Inside the JSX, locate where `onAsk` is wired to a button (likely an ask icon / label). Insert a sibling button immediately before or after it:

```tsx
<button
  className="tb-btn"
  title="New note (⌘+)"
  onClick={onCapture}
>
  +
</button>
```

If Titlebar uses a different className convention (e.g. the file shows `className="iconbtn"` or similar), use whichever class the existing `onAsk` button uses — the button is meant to look native next to it. No new CSS classes needed for Phase 1; the inline `+` glyph is acceptable interim styling.

- [ ] **Step 3: Verify the frontend builds**

Run: `cd /Users/sushil/Code/mastisk/frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/NoteCaptureModal.tsx frontend/src/components/Titlebar.tsx
git commit -m "notes(frontend): NoteCaptureModal + titlebar capture button"
```

---

### Task 12: NotesView — list of all notes

**Files:**
- Create: `frontend/src/components/NotesView.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Note, View } from '../types';

interface Props {
  onNavigate: (view: View, id?: string) => void;
}

export function NotesView({ onNavigate }: Props) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.notes.list(100)
      .then(setNotes)
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  if (err) return <div className="view"><p style={{ color: 'var(--danger, crimson)' }}>{err}</p></div>;
  if (!notes) return <div className="view"><p style={{ color: 'var(--fg-faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>loading…</p></div>;

  if (notes.length === 0) {
    return (
      <div className="view">
        <div className="view-h">Notes</div>
        <h1 className="view-title">No notes yet</h1>
        <p className="view-sub">
          Hit the <kbd>+</kbd> in the titlebar, or run <code>mastisk note "your thought"</code>, or drop a
          markdown file into <code>vault/_notes/inbox/</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view-h">Notes</div>
      <h1 className="view-title">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {notes.map((n) => (
          <button
            key={n.id}
            onClick={() => onNavigate('note', String(n.id))}
            style={{
              textAlign: 'left', padding: 10,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-soft, transparent)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-faint)' }}>
              {new Date(n.created_at).toLocaleString()} · {n.source}
              {n.classification && <> · <span>{n.classification}</span></>}
              {!n.classification && <> · <span style={{ opacity: 0.6 }}>unclassified</span></>}
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {n.summary ?? n.slug}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the frontend builds**

Run: `cd /Users/sushil/Code/mastisk/frontend && npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/NotesView.tsx
git commit -m "notes(frontend): NotesView list component"
```

---

### Task 13: NoteView — single note detail

**Files:**
- Create: `frontend/src/components/NoteView.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Note, View } from '../types';

interface Props {
  noteId: number;
  onNavigate: (view: View, id?: string) => void;
}

export function NoteView({ noteId, onNavigate }: Props) {
  const [note, setNote] = useState<Note | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setNote(null);
    setErr(null);
    api.notes.get(noteId)
      .then(setNote)
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [noteId]);

  const onDelete = useCallback(async () => {
    if (!note) return;
    if (!confirm(`Delete note?\n\n${note.summary ?? note.slug}`)) return;
    setDeleting(true);
    try {
      await api.notes.delete(note.id);
      onNavigate('notes');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
      setDeleting(false);
    }
  }, [note, onNavigate]);

  if (err) return <div className="view"><p style={{ color: 'var(--danger, crimson)' }}>{err}</p></div>;
  if (!note) return <div className="view"><p style={{ color: 'var(--fg-faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>loading…</p></div>;

  return (
    <div className="view">
      <div className="view-h">Note · {note.source}</div>
      <h1 className="view-title">{note.summary ?? note.slug}</h1>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-faint)', marginBottom: 12 }}>
        {new Date(note.created_at).toLocaleString()}
        {note.classification && <> · {note.classification}</>}
        {note.tags.length > 0 && <> · {note.tags.map(t => `#${t}`).join(' ')}</>}
      </div>
      <pre
        style={{
          whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 14,
          background: 'var(--bg-soft, transparent)',
          border: '1px solid var(--border)', borderRadius: 6, padding: 12,
        }}
      >{note.body}</pre>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button onClick={() => onNavigate('notes')}>← all notes</button>
        <button onClick={onDelete} disabled={deleting} style={{ marginLeft: 'auto' }}>
          {deleting ? 'deleting…' : 'delete'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the frontend builds**

Run: `cd /Users/sushil/Code/mastisk/frontend && npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/NoteView.tsx
git commit -m "notes(frontend): NoteView detail component"
```

---

### Task 14: App.tsx wire-up — view switch + modal state

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Import the new components + state**

Near the top of `App.tsx`, add:

```tsx
import { NotesView } from './components/NotesView';
import { NoteView } from './components/NoteView';
import { NoteCaptureModal } from './components/NoteCaptureModal';
```

Inside the `App()` component, alongside the other `useState` calls, add:

```tsx
const [captureOpen, setCaptureOpen] = useState(false);
```

- [ ] **Step 2: Wire the Titlebar capture button**

Find the `<Titlebar ... />` JSX and add the prop:

```tsx
<Titlebar
  /* ...existing props... */
  onCapture={() => setCaptureOpen(true)}
/>
```

- [ ] **Step 3: Add view switch entries**

In the main JSX (the `<main className="main">` block that switches on `view`), add:

```tsx
{view === 'notes' && <NotesView onNavigate={navigate} />}
{view === 'note' && route.noteId !== null && <NoteView noteId={route.noteId} onNavigate={navigate} />}
```

- [ ] **Step 4: Render the modal at app level**

Near the bottom of the `return`, next to `<AskDrawer ... />`, add:

```tsx
<NoteCaptureModal
  open={captureOpen}
  onClose={() => setCaptureOpen(false)}
  onCaptured={(id) => navigate('note', String(id))}
/>
```

- [ ] **Step 5: Verify the frontend builds and runs**

Run: `cd /Users/sushil/Code/mastisk/frontend && npm run build && cd .. && uv run mastisk dev`
In another terminal: open http://localhost:8080 → click the `+` in titlebar → capture a note → land on the note detail view.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "notes(frontend): wire NotesView + NoteView + capture modal into App"
```

---

### Task 15: End-to-end smoke + rebuild packaged PWA

**Files:**
- (none modified in this task — just verification)

- [ ] **Step 1: Full pytest pass**

Run: `cd /Users/sushil/Code/mastisk && uv run pytest -v`
Expected: all tests PASS. Record failures as regressions to fix before continuing.

- [ ] **Step 2: Full frontend typecheck + build**

Run: `cd /Users/sushil/Code/mastisk/frontend && npm run build`
Expected: zero TypeScript errors. The build emits into `src/mastisk/pwa/` per the existing Vite config.

- [ ] **Step 3: Live smoke test (three capture paths)**

Start mastisk: `cd /Users/sushil/Code/mastisk && uv run mastisk dev` (background), then in another terminal:

a) CLI path:
```bash
uv run mastisk note "cli capture: first"
```
Expected: `captured #1: <HHMMSS>-cli-capture-first`.

b) API path (simulates PWA):
```bash
curl -X POST http://localhost:8080/api/notes \
  -H 'content-type: application/json' \
  -d '{"text":"api capture: second","source":"pwa"}'
```
Expected: 201 with `{id, slug, path}`.

c) Vault-drop path:
```bash
echo "vault drop: third" > "$(uv run python -c 'from mastisk.paths import notes_inbox_dir; print(notes_inbox_dir())')/manual-drop.md"
```
(No DB row yet — Phase 2's Notetaker will discover this. For now just confirm the file lands in inbox.)

d) List:
```bash
curl http://localhost:8080/api/notes | python -m json.tool
```
Expected: array with at least two entries (cli + api captures; the vault drop is not yet indexed — that's Phase 2).

- [ ] **Step 4: Commit a README stanza documenting the new capture paths**

Append to `README.md` under "Bootstrap content" or as a new section:

```markdown
## Capturing notes

Three ways, any combination:

- **PWA:** click the `+` in the titlebar, type, ⌘↵ to save.
- **CLI:** `mastisk note "a quick thought"` or `mastisk note` (opens `$EDITOR`).
- **Any editor:** drop a `.md` file into `vault/_notes/inbox/` — Obsidian, Files app, vim, iOS Shortcut to Files, etc.

Notes live in `vault/_notes/YYYY-MM-DD/` once classified. Phase 2 (classification) is next.
```

```bash
git add README.md
git commit -m "notes: README — document capture paths (PWA / CLI / vault drop)"
```

- [ ] **Step 5: Phase 1 complete.** Subsequent plan (`2026-04-21-notes-phase-2-notetaker.md`) adds the Notetaker agent, Ollama classification, frontmatter writing, and link insertion.

---

## Self-Review Checklist (for the executor, before declaring Phase 1 done)

1. Can you capture a note from the PWA, CLI, and Obsidian-style file drop? (Phase 2 picks up the file drop; in Phase 1 only PWA/CLI index it — that's expected.)
2. Does `pytest` run cleanly with zero failures?
3. Does `npm run build` finish with zero type errors?
4. Are all 15 task commits present in `git log`?
5. Does `DELETE /api/notes/:id` actually remove the file from the vault?
6. Does the modal's `⌘↵` keyboard shortcut work?
7. Does `mastisk note` (no arg) correctly open `$EDITOR` and discard-on-empty?
8. Do the 3 new tables show up in `sqlite3 ~/Library/Application\ Support/Mastisk/mastisk.db ".schema" | grep notes`?
9. Does the existing `articles` table now have `source_note_id` as a column?
10. Did the existing Scout/Listener/Synthesizer tests still pass (if any existed)?

---

## Risks & Follow-Ups

- **Slug collision "path replace" is fragile.** Task 6's `atomic_write` writes to the slug-derived filename, and the DB-insert helper renames to `<slug>-N` on collision. The route then reconciles by renaming the file. If this sequencing has a bug, two tests should catch it (`test_insert_note_slug_collision_appends_suffix` + a future "burst capture" test). If it proves fragile in practice, refactor to a two-phase approach: reserve slug first, then write file.
- **iCloud file-write latency not exercised.** Task 15 step 3c drops a file directly but doesn't wait — Phase 2 is where the stability check actually matters.
- **PWA styling is inline.** Phase 1 uses inline style attributes on the new components rather than extending `mastisk.css`. Fine for bootstrapping; a later polish pass can move to CSS classes matching the existing design system.
- **No frontend tests.** The existing repo has none. Rather than introduce `vitest` as a Phase 1 dep, manual smoke in Task 15 is the verification. Adding frontend tests is a separate, optional follow-up.
- **Offline PWA capture.** Service-worker IndexedDB queue is deferred per spec §15 — Phase 1 ships with a visible error on offline POST.

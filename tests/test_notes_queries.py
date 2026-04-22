"""Tests for note-related DB queries."""
from __future__ import annotations

import sqlite3
from datetime import datetime

import pytest


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


def test_fk_enforcement_on_note_links(db):
    """PRAGMA foreign_keys=ON (set in connect()) makes bogus note_id rejected."""
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO note_links (note_id, article_id, rank) VALUES (?, ?, ?)",
            (999999, "nonexistent-article", 0),
        )


def test_notes_column_defaults(db):
    """Minimal insert: unset columns take their schema defaults (state=none, tags='[]', retry=0)."""
    db.execute(
        """INSERT INTO notes (slug, path, body, body_sha256, source, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            "defaults-probe", "_notes/inbox/defaults-probe.md",
            "body", "0" * 64, "pwa", datetime(2026, 4, 21).isoformat(),
        ),
    )
    row = db.execute("SELECT * FROM notes WHERE slug = 'defaults-probe'").fetchone()
    assert row["escalation_state"] == "none"
    assert row["tags_json"] == "[]"
    assert row["escalation_retry_count"] == 0
    assert row["classification"] is None
    assert row["classified_at"] is None
    assert row["deleted_at"] is None


def test_notes_dir_helpers(vault_tmp):
    from mastisk.paths import notes_dir, notes_inbox_dir, notes_daily_dir, ensure_dirs
    ensure_dirs()
    assert notes_dir().exists()
    assert notes_inbox_dir().exists()
    assert notes_daily_dir().exists()
    assert notes_dir() == vault_tmp / "_notes"
    assert notes_inbox_dir() == vault_tmp / "_notes" / "inbox"


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
    assert row["body_sha256"] != ""


def test_insert_note_slug_collision_appends_suffix(db):
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
    row = get_note(db, note_id)
    assert row is not None
    assert row["deleted_at"] is not None

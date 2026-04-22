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

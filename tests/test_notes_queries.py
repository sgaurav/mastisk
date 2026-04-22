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

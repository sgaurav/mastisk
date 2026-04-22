"""Tests for the roundtable tables + indexes added in Phase A.
See docs/superpowers/specs/2026-04-22-multi-llm-roundtable-design.md §5."""
from __future__ import annotations

import sqlite3

import pytest


def test_roundtable_tables_exist(db):
    tables = {
        r["name"]
        for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert "roundtables" in tables
    assert "roundtable_perspectives" in tables


def test_roundtable_indexes_exist(db):
    indexes = {
        r["name"]
        for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='index'"
        ).fetchall()
    }
    assert "idx_roundtables_created" in indexes
    assert "idx_roundtables_status" in indexes
    assert "idx_roundtables_input" in indexes
    assert "idx_roundtable_perspectives_rt" in indexes


def test_roundtables_default_status_is_pending(db):
    """Minimal insert: status defaults to 'pending' per schema."""
    db.execute(
        "INSERT INTO roundtables (input_type, input_ref, prompt) VALUES (?, ?, ?)",
        ("prompt", "", "hello"),
    )
    row = db.execute("SELECT status FROM roundtables WHERE id = 1").fetchone()
    assert row["status"] == "pending"


def test_roundtable_perspectives_cascade_delete(db):
    """Deleting a roundtable wipes its perspective rows via FK ON DELETE CASCADE."""
    cur = db.execute(
        "INSERT INTO roundtables (input_type, input_ref, prompt) VALUES (?, ?, ?)",
        ("prompt", "", "q"),
    )
    rt_id = cur.lastrowid
    db.execute(
        "INSERT INTO roundtable_perspectives (roundtable_id, backend) VALUES (?, ?)",
        (rt_id, "claude"),
    )
    assert db.execute(
        "SELECT COUNT(*) AS n FROM roundtable_perspectives"
    ).fetchone()["n"] == 1
    db.execute("DELETE FROM roundtables WHERE id = ?", (rt_id,))
    assert db.execute(
        "SELECT COUNT(*) AS n FROM roundtable_perspectives"
    ).fetchone()["n"] == 0


def test_roundtable_perspectives_rejects_bad_fk(db):
    """FK enforcement: inserting a perspective for a nonexistent roundtable fails."""
    with pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "INSERT INTO roundtable_perspectives (roundtable_id, backend) VALUES (?, ?)",
            (999999, "claude"),
        )

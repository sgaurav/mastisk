"""Tests for vault_integrity_scan — tombstoning and iCloud-placeholder tolerance."""
from __future__ import annotations

import asyncio
from datetime import datetime


def test_tombstones_note_whose_file_is_gone(db, vault_tmp):
    from mastisk.agents.vault_integrity import vault_integrity_scan
    from mastisk.db.queries import insert_note
    from mastisk.paths import notes_inbox_dir

    inbox = notes_inbox_dir()
    inbox.mkdir(parents=True, exist_ok=True)
    file_path = inbox / "090000-gone.md"
    file_path.write_text("original body")
    rel = str(file_path.relative_to(vault_tmp))
    note_id = insert_note(
        db, slug="090000-gone", path=rel, body="original body",
        source="file", created_at=datetime(2026, 4, 21, 9, 0),
    )
    file_path.unlink()  # simulate external delete (Obsidian, Finder, etc.)
    assert not file_path.exists()

    asyncio.run(vault_integrity_scan())

    row = db.execute("SELECT deleted_at FROM notes WHERE id = ?", (note_id,)).fetchone()
    assert row["deleted_at"] is not None


def test_does_not_tombstone_icloud_placeholder(db, vault_tmp):
    """A .icloud placeholder means the file is pending download — NOT deleted."""
    from mastisk.agents.vault_integrity import vault_integrity_scan
    from mastisk.db.queries import insert_note
    from mastisk.paths import notes_inbox_dir

    inbox = notes_inbox_dir()
    inbox.mkdir(parents=True, exist_ok=True)
    placeholder = inbox / ".090000-pending.md.icloud"
    placeholder.write_text("")  # iCloud placeholders are zero-byte hidden files
    rel = "_notes/inbox/090000-pending.md"
    note_id = insert_note(
        db, slug="090000-pending", path=rel, body="body",
        source="pwa", created_at=datetime(2026, 4, 21, 9, 0),
    )

    asyncio.run(vault_integrity_scan())

    row = db.execute("SELECT deleted_at FROM notes WHERE id = ?", (note_id,)).fetchone()
    assert row["deleted_at"] is None, (
        "should NOT tombstone if an iCloud placeholder is present"
    )


def test_skips_already_tombstoned_notes(db, vault_tmp):
    """Already-deleted notes are not re-processed (the WHERE clause is the whole point)."""
    from mastisk.agents.vault_integrity import vault_integrity_scan

    db.execute(
        """INSERT INTO notes (slug, path, body, body_sha256, source, created_at, deleted_at)
           VALUES ('gone', '_notes/inbox/gone.md', 'b', 'sha', 'pwa', ?, ?)""",
        (
            datetime(2026, 4, 21, 9, 0).isoformat(),
            datetime(2026, 4, 21, 10, 0).isoformat(),
        ),
    )
    before = db.execute(
        "SELECT deleted_at FROM notes WHERE slug='gone'"
    ).fetchone()["deleted_at"]
    asyncio.run(vault_integrity_scan())
    after = db.execute(
        "SELECT deleted_at FROM notes WHERE slug='gone'"
    ).fetchone()["deleted_at"]
    assert before == after


def test_leaves_notes_whose_file_exists(db, vault_tmp):
    """Notes with still-present vault files are untouched."""
    from mastisk.agents.vault_integrity import vault_integrity_scan
    from mastisk.db.queries import insert_note
    from mastisk.paths import notes_inbox_dir

    inbox = notes_inbox_dir()
    inbox.mkdir(parents=True, exist_ok=True)
    file_path = inbox / "090000-here.md"
    file_path.write_text("still here")
    rel = str(file_path.relative_to(vault_tmp))
    note_id = insert_note(
        db, slug="090000-here", path=rel, body="still here",
        source="file", created_at=datetime(2026, 4, 21, 9, 0),
    )

    asyncio.run(vault_integrity_scan())

    row = db.execute("SELECT deleted_at FROM notes WHERE id = ?", (note_id,)).fetchone()
    assert row["deleted_at"] is None

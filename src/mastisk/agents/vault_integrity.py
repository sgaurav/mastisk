"""Vault integrity: tombstone notes whose vault file was deleted externally.

Runs every 5 minutes via the scheduler. See spec §9.5 (Option B — tombstone,
not cascade). Stub articles that already escalated from a now-deleted note
keep their ``source_note_id`` back-reference; the PWA handles "(note deleted)"
in the UI.
"""
from __future__ import annotations

import logging

from mastisk.db.queries import connect
from mastisk.paths import vault_dir

log = logging.getLogger("mastisk.vault_integrity")


async def vault_integrity_scan() -> None:
    """Mark as ``deleted_at`` any non-deleted note whose vault file is missing.

    Best-effort. A transient iCloud placeholder (``.<name>.icloud``) does NOT
    tombstone — we specifically check for the physical file's presence, or a
    sibling placeholder that means "pending download" rather than "gone."
    """
    checked = 0
    tombstoned = 0
    with connect() as conn:
        # Pull only live rows — already-tombstoned ones don't need re-checking
        rows = conn.execute(
            "SELECT id, path FROM notes WHERE deleted_at IS NULL"
        ).fetchall()

    for row in rows:
        checked += 1
        file_path = vault_dir() / row["path"]
        icloud_placeholder = file_path.parent / f".{file_path.name}.icloud"
        if file_path.exists() or icloud_placeholder.exists():
            continue
        # File is missing (not an iCloud placeholder). Tombstone.
        with connect() as conn:
            conn.execute(
                "UPDATE notes SET deleted_at = CURRENT_TIMESTAMP "
                "WHERE id = ? AND deleted_at IS NULL",
                (row["id"],),
            )
        tombstoned += 1
        log.info(
            "vault_integrity: tombstoned note %s (file missing: %s)",
            row["id"], row["path"],
        )

    if checked:
        log.info("vault_integrity: checked %d, tombstoned %d", checked, tombstoned)

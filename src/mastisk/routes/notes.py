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
    with connect() as conn:
        row = q.get_note(conn, note_id)
    # If insert_note hit a slug collision, the DB's final path has a `-N` suffix.
    # The file was written with the original name; rename it to match.
    actual_path = vault_dir() / row["path"]
    if actual_path != target:
        target.rename(actual_path)
    return {
        "id": note_id,
        "slug": row["slug"],
        "path": row["path"],
        "created_at": row["created_at"],
    }

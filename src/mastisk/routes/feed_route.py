"""Agent ticker — latest N entries + an SSE live stream."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from mastisk.db import queries as q
from mastisk.db.queries import connect

router = APIRouter(tags=["feed"])


@router.get("/feed")
def feed(limit: int = 50):
    with connect() as conn:
        return {"feed": q.recent_feed(conn, limit=limit), "agents": _agents_snapshot(conn)}


def _agents_snapshot(conn) -> list[dict]:
    """Hard-coded for now. Load/pending stats will be wired when the scheduler lands."""
    return [
        {"id": "scout",       "name": "Scout",       "role": "Crawls feeds, blogs, RSS", "status": "active", "load": 0.62, "color": "amber"},
        {"id": "listener",    "name": "Listener",    "role": "Transcribes podcasts + YouTube", "status": "idle", "load": 0.0, "color": "violet"},
        {"id": "compiler",    "name": "Compiler",    "role": "Compiles raw → wiki, builds backlinks", "status": "active", "load": 0.44, "color": "emerald"},
        {"id": "linter",      "name": "Linter",      "role": "Health checks, broken links, contradictions", "status": "idle", "load": 0.05, "color": "blue"},
        {"id": "synthesizer", "name": "Synthesizer", "role": "Cross-source synthesis, themes", "status": "idle", "load": 0.0, "color": "rose"},
    ]


@router.get("/feed/stream")
async def feed_stream(request: Request):
    """SSE stream — pushes new feed rows as they appear."""
    async def event_gen():
        last_id = _peek_last_feed_id()
        while True:
            if await request.is_disconnected():
                break
            rows = _new_feed_rows_since(last_id)
            for row in rows:
                last_id = max(last_id, row["id"])
                yield {"event": "tick", "data": json.dumps(row)}
            await asyncio.sleep(2)

    return EventSourceResponse(event_gen())


def _peek_last_feed_id() -> int:
    with connect() as conn:
        row = conn.execute("SELECT COALESCE(MAX(id), 0) AS id FROM feed").fetchone()
        return int(row["id"]) if row else 0


def _new_feed_rows_since(last_id: int) -> list[dict]:
    with connect() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM feed WHERE id > ? ORDER BY id ASC LIMIT 50", (last_id,)
        )]
    return [{**r, **q._feed_row_for_ui(r)} for r in rows]

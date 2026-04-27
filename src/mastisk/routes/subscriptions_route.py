"""Subscriptions API — register/list/remove RSS, YouTube, and podcast feeds.

The data model (subscriptions table) is created in
:mod:`mastisk.db.schema`. This module surfaces it over HTTP and via the
shared queries.py helpers. URL classification lives in
:mod:`mastisk.integrations.subscriptions`.
"""
from __future__ import annotations

from urllib.parse import unquote

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from mastisk.db import queries as q
from mastisk.db.queries import connect
from mastisk.integrations.subscriptions import ResolveError, Resolved, resolve

router = APIRouter(tags=["subscriptions"])


# ─── Request models ──────────────────────────────────────────────────────

class ProbeIn(BaseModel):
    url: str


class CreateIn(BaseModel):
    url: str
    title: str | None = None
    backfill: int | None = None
    bypass_interest_gate: bool | None = None


class PatchIn(BaseModel):
    title: str | None = None
    max_per_poll: int | None = None
    bypass_interest_gate: bool | None = None


# ─── Routes ──────────────────────────────────────────────────────────────

@router.post("/subscriptions/probe")
async def probe(body: ProbeIn):
    """Resolve a user-pasted URL into one of {rss, youtube, podcast} without
    writing to the database. Used by the Add Subscription modal for live
    feedback."""
    try:
        r = await resolve(body.url)
    except ResolveError as e:
        raise HTTPException(400, str(e))
    return _resolved_dict(r)


@router.get("/subscriptions")
def list_subscriptions():
    with connect() as conn:
        rows = q.list_subscriptions(conn)
    for r in rows:
        r["enabled"] = bool(r["enabled"])
        r["bypass_interest_gate"] = bool(r["bypass_interest_gate"])
    return {"subscriptions": rows}


@router.post("/subscriptions")
async def create(body: CreateIn):
    try:
        r = await resolve(body.url)
    except ResolveError as e:
        raise HTTPException(400, str(e))

    title = (body.title or "").strip() or r.title
    backfill = body.backfill if body.backfill is not None else 3
    if body.bypass_interest_gate is None:
        # Default: bypass the interest gate for YouTube/podcast subscriptions
        # — if you subscribed, you want everything. RSS keeps the gate active.
        bypass = r.kind in ("youtube", "podcast")
    else:
        bypass = body.bypass_interest_gate

    with connect() as conn:
        row = q.add_subscription(
            conn,
            url=r.url,
            kind=r.kind,
            source_url=r.source_url,
            title=title,
            backfill=int(backfill),
            bypass_interest_gate=bypass,
        )
    row["enabled"] = bool(row["enabled"])
    row["bypass_interest_gate"] = bool(row["bypass_interest_gate"])
    return {"ok": True, "subscription": row, "resolved": _resolved_dict(r)}


@router.get("/subscriptions/{url:path}")
def get_one(url: str):
    url = unquote(url)
    with connect() as conn:
        row = q.get_subscription(conn, url)
    if not row:
        raise HTTPException(404, "subscription not found")
    row["enabled"] = bool(row["enabled"])
    row["bypass_interest_gate"] = bool(row["bypass_interest_gate"])
    with connect() as conn:
        items = q.recent_items_for_subscription(conn, url, limit=20)
    return {"subscription": row, "recent_items": items}


@router.delete("/subscriptions/{url:path}")
def remove(url: str):
    url = unquote(url)
    with connect() as conn:
        ok = q.remove_subscription(conn, url)
    if not ok:
        raise HTTPException(404, "subscription not found")
    return {"ok": True}


@router.post("/subscriptions/{url:path}/toggle")
def toggle(url: str):
    url = unquote(url)
    with connect() as conn:
        row = q.toggle_subscription(conn, url)
    if not row:
        raise HTTPException(404, "subscription not found")
    row["enabled"] = bool(row["enabled"])
    row["bypass_interest_gate"] = bool(row["bypass_interest_gate"])
    return {"ok": True, "subscription": row}


@router.patch("/subscriptions/{url:path}")
def patch(url: str, body: PatchIn):
    url = unquote(url)
    with connect() as conn:
        row = q.update_subscription(
            conn, url,
            title=body.title,
            max_per_poll=body.max_per_poll,
            bypass_interest_gate=body.bypass_interest_gate,
        )
    if not row:
        raise HTTPException(404, "subscription not found")
    row["enabled"] = bool(row["enabled"])
    row["bypass_interest_gate"] = bool(row["bypass_interest_gate"])
    return {"ok": True, "subscription": row}


@router.post("/subscriptions/{url:path}/poll")
async def force_poll(url: str, background: BackgroundTasks):
    """Trigger a Scout fetch for this subscription right now. Runs in the
    background so the request returns quickly."""
    url = unquote(url)
    from mastisk.agents.scout import Scout

    with connect() as conn:
        row = q.get_subscription(conn, url)
    if not row:
        raise HTTPException(404, "subscription not found")

    async def run():
        await Scout()._fetch_feed(url)

    background.add_task(run)
    return {"ok": True, "queued": url}


# ─── helpers ─────────────────────────────────────────────────────────────

def _resolved_dict(r: Resolved) -> dict:
    return {
        "kind": r.kind,
        "url": r.url,
        "source_url": r.source_url,
        "title": r.title,
        "item_count": r.item_count,
    }

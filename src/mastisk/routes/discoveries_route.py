"""Discoveries API — list / accept / save / dismiss / block-domain.

Backed by the `discoveries` and `discovery_blocklist` tables. Curator
agent populates the table; this route surfaces it to the PWA.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from mastisk.db import queries as q
from mastisk.db.queries import connect
from mastisk.integrations import subscriptions, web

log = logging.getLogger("mastisk.discoveries_route")

router = APIRouter(tags=["discoveries"])


@router.get("/discoveries")
def list_endpoint(status: str = "open", kind: str | None = None, limit: int = 50):
    with connect() as conn:
        rows = q.list_discoveries(conn, status=status, kind=kind, limit=limit)
        open_count = q.count_open_discoveries(conn)
    return {"discoveries": rows, "open_count": open_count}


@router.post("/discoveries/{discovery_id}/accept")
async def accept(discovery_id: int):
    """Subscribe to the candidate via the Subscriptions resolver."""
    with connect() as conn:
        d = q.get_discovery(conn, discovery_id)
    if not d:
        raise HTTPException(404, "discovery not found")
    if d["status"] != "open":
        raise HTTPException(400, f"discovery already {d['status']}")
    try:
        resolved = await subscriptions.resolve(d["url"])
    except subscriptions.ResolveError as e:
        raise HTTPException(400, f"couldn't resolve as a subscription: {e}") from e
    with connect() as conn:
        q.add_subscription(
            conn,
            url=resolved.url,
            kind=resolved.kind,
            source_url=resolved.source_url,
            title=d["title"] or resolved.title,
            backfill=3,
            bypass_interest_gate=resolved.kind in ("youtube", "podcast"),
        )
        row = q.set_discovery_status(conn, discovery_id, "accepted")
    return {"ok": True, "discovery": row, "subscribed_url": resolved.url}


@router.post("/discoveries/{discovery_id}/save")
async def save(discovery_id: int):
    """Ingest the candidate URL once via web.ingest_url; mark saved."""
    with connect() as conn:
        d = q.get_discovery(conn, discovery_id)
    if not d:
        raise HTTPException(404, "discovery not found")
    if d["status"] != "open":
        raise HTTPException(400, f"discovery already {d['status']}")
    try:
        result = await web.ingest_url(d["url"])
    except RuntimeError as e:
        raise HTTPException(400, str(e)) from e
    with connect() as conn:
        row = q.set_discovery_status(conn, discovery_id, "saved")
    return {"ok": True, "discovery": row, "source_id": result["source_id"]}


@router.post("/discoveries/{discovery_id}/dismiss")
def dismiss(discovery_id: int):
    with connect() as conn:
        d = q.get_discovery(conn, discovery_id)
        if not d:
            raise HTTPException(404, "discovery not found")
        row = q.set_discovery_status(conn, discovery_id, "dismissed")
    return {"ok": True, "discovery": row}


class BlockIn(BaseModel):
    reason: str | None = None


@router.post("/discoveries/{discovery_id}/block-domain")
def block_domain(discovery_id: int, body: BlockIn | None = None):
    """Add the discovery's domain to the blocklist + mark dismissed.
    One-click; the UI shows an undo toast that calls DELETE /blocklist/{domain}."""
    with connect() as conn:
        d = q.get_discovery(conn, discovery_id)
        if not d:
            raise HTTPException(404, "discovery not found")
        q.add_to_blocklist(conn, d["domain"], reason=(body.reason if body else None))
        row = q.set_discovery_status(conn, discovery_id, "dismissed")
    return {"ok": True, "discovery": row, "blocked_domain": d["domain"]}


@router.get("/discoveries/blocklist")
def list_blocklist_endpoint():
    with connect() as conn:
        return {"blocklist": q.list_blocklist(conn)}


@router.delete("/discoveries/blocklist/{domain}")
def unblock_domain(domain: str):
    with connect() as conn:
        ok = q.remove_from_blocklist(conn, domain)
    if not ok:
        raise HTTPException(404, "domain not in blocklist")
    return {"ok": True, "unblocked": domain}


@router.post("/curator/run")
async def curator_run(background: BackgroundTasks):
    """Trigger a Curator cycle in the background. Returns immediately."""
    from mastisk.agents.curator import Curator

    async def _run():
        try:
            await Curator()._cycle(force=True)
        except Exception:
            log.exception("manual curator run failed")

    background.add_task(_run)
    return {"ok": True, "message": "Curator cycle queued; refresh in 30–60s"}

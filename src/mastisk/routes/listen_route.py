"""POST /api/listen — enqueue a single URL of any kind for ingestion.

Dispatches by content kind:
- youtube / podcast feed / direct audio  → Listener (transcribe)
- spotify                                → reject (DRM)
- everything else (blog/article)         → web.ingest_url → Compiler

Used by the "Paste a link" form on Sources & ingest, plus the
``mastisk add-youtube`` / ``mastisk add-podcast`` CLI commands.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from mastisk.agents.base import enqueue
from mastisk.integrations import podcasts, web

log = logging.getLogger("mastisk.listen_route")

router = APIRouter(tags=["listener"])


class ListenIn(BaseModel):
    url: str


@router.post("/listen")
async def listen(body: ListenIn) -> dict:
    url = (body.url or "").strip()
    if not url:
        raise HTTPException(400, "url required")

    try:
        cls = await podcasts.classify(url)
    except Exception as e:
        log.info("classify failed for %s: %s", url, e)
        cls = "unknown"

    if cls == "spotify":
        raise HTTPException(
            400,
            "Spotify podcasts are DRM-protected and can't be ingested. "
            "Try the podcast's RSS feed URL or Apple Podcasts link.",
        )

    if cls in ("youtube", "rss", "direct_audio"):
        # Listener handles audio/video end-to-end. For RSS Listener pulls the
        # latest episode — matches the existing ad-hoc-podcast behavior.
        job_id = enqueue("listener", "transcribe", {"url": url})
        return {
            "job_id": job_id,
            "kind": "transcribe",
            "message": f"queued {cls} for transcription (job {job_id})",
        }

    # Otherwise treat as a plain web/blog URL: fetch + extract + compile.
    try:
        result = await web.ingest_url(url)
    except RuntimeError as e:
        raise HTTPException(400, str(e)) from e

    if result["dedup"]:
        return {
            "job_id": None,
            "kind": "compile",
            "source_id": result["source_id"],
            "message": f"already saved · {result['title']}",
        }
    return {
        "job_id": result["job_id"],
        "kind": "compile",
        "source_id": result["source_id"],
        "message": f"compiling “{result['title']}” (job {result['job_id']})",
    }

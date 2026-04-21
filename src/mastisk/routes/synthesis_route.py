"""Synthesizer feedback — accept/discard affordance on Synthesis articles.

The Synthesizer agent drafts articles and persists a row to ``synthesis_runs``
with ``user_accepted IS NULL``. The ArticleView pulls this row for the open
article and shows a feedback strip; the user clicks Keep or Discard-with-reason,
and this module flips ``user_accepted`` accordingly. Rejected runs optionally
carry free-text feedback that the Synthesizer re-uses as few-shot material on
subsequent drafts.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mastisk.db import queries as q
from mastisk.db.queries import connect

router = APIRouter(tags=["synthesis"])


class RejectBody(BaseModel):
    """POST body for reject. ``feedback`` is optional free text."""
    feedback: str | None = Field(default=None, max_length=4000)


@router.get("/synthesis/pending")
def list_pending():
    """All runs awaiting a user decision, newest first."""
    with connect() as conn:
        return {"runs": q.list_pending_synthesis_runs(conn)}


@router.get("/synthesis/by-article/{article_id}")
def by_article(article_id: str):
    """Most recent run whose draft_article_id matches, or ``{"run": null}``.

    Returning an envelope (``{run: ...}``) rather than the bare row lets the
    client distinguish "no data yet" from "explicitly no run" without a 404.
    """
    with connect() as conn:
        return {"run": q.get_synthesis_run_for_article(conn, article_id)}


@router.post("/synthesis/{run_id}/accept")
def accept(run_id: int):
    """Mark a pending run as accepted.

    404 if the row doesn't exist or has already been decided. We do the
    existence check separately so the two cases can be distinguished in logs,
    but the client just retries-or-ignores either way.
    """
    with connect() as conn:
        ok = q.mark_synthesis_accepted(conn, run_id)
        if not ok:
            # Either missing or already decided — either way, nothing to do.
            exists = conn.execute(
                "SELECT 1 FROM synthesis_runs WHERE id = ?", (run_id,)
            ).fetchone()
            if not exists:
                raise HTTPException(404, "synthesis run not found")
            raise HTTPException(409, "synthesis run already decided")
    return {"ok": True}


@router.post("/synthesis/{run_id}/reject")
def reject(run_id: int, body: RejectBody | None = None):
    """Mark a pending run as rejected; optionally store feedback text."""
    feedback = body.feedback if body is not None else None
    with connect() as conn:
        ok = q.mark_synthesis_rejected(conn, run_id, feedback)
        if not ok:
            exists = conn.execute(
                "SELECT 1 FROM synthesis_runs WHERE id = ?", (run_id,)
            ).fetchone()
            if not exists:
                raise HTTPException(404, "synthesis run not found")
            raise HTTPException(409, "synthesis run already decided")
    return {"ok": True}

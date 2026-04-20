from __future__ import annotations

from fastapi import APIRouter, HTTPException

from mastisk.db import queries as q
from mastisk.db.queries import connect

router = APIRouter(tags=["articles"])


@router.get("/articles")
def list_articles(kind: str | None = None, limit: int = 200):
    with connect() as conn:
        return {"articles": q.list_articles(conn, kind=kind, limit=limit)}


@router.get("/articles/{article_id}")
def get_article(article_id: str):
    with connect() as conn:
        art = q.get_article(conn, article_id)
        if not art:
            raise HTTPException(404, "article not found")
        return art


@router.get("/sidebar")
def sidebar():
    with connect() as conn:
        return {
            "vault":  q.vault_tree(conn),
            "pinned": q.pinned_list(conn),
            "user":   q.user_info(conn),
        }


@router.post("/articles/{article_id}/pin")
def pin(article_id: str):
    with connect() as conn:
        q.pin_article(conn, article_id)
        q.add_signal(conn, article_id=article_id, kind="pinned")
    return {"ok": True}


@router.delete("/articles/{article_id}/pin")
def unpin(article_id: str):
    with connect() as conn:
        q.unpin_article(conn, article_id)
        q.add_signal(conn, article_id=article_id, kind="unpinned")
    return {"ok": True}

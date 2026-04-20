from __future__ import annotations

from fastapi import APIRouter

from mastisk.db import queries as q
from mastisk.db.queries import connect

router = APIRouter(tags=["search"])


@router.get("/search")
def search(q_param: str = "", limit: int = 20):
    # FastAPI doesn't love "q" as a param name in some tooling; accept both
    with connect() as conn:
        return {"results": q.search_articles(conn, q_param, limit=limit)}


@router.get("/search/{q_param}")
def search_path(q_param: str, limit: int = 20):
    with connect() as conn:
        return {"results": q.search_articles(conn, q_param, limit=limit)}

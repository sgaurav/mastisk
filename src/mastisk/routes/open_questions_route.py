"""Open questions — every article_section with kind='open', grouped by article."""
from __future__ import annotations

from fastapi import APIRouter

from mastisk.db.queries import connect

router = APIRouter(tags=["open_questions"])


@router.get("/open-questions")
def open_questions():
    with connect() as conn:
        rows = conn.execute(
            """SELECT articles.id        AS article_id,
                      articles.title     AS article_title,
                      articles.kind      AS article_kind,
                      article_sections.heading AS heading,
                      article_sections.body    AS body,
                      articles.updated_at      AS updated_at
               FROM article_sections
               JOIN articles ON articles.id = article_sections.article_id
               WHERE article_sections.kind = 'open'
               ORDER BY articles.updated_at DESC, articles.id, article_sections.idx"""
        ).fetchall()
        return {"questions": [dict(r) for r in rows]}

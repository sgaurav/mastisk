"""Daily digest — what the agents did recently."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter

from mastisk.db.queries import connect

router = APIRouter(tags=["digest"])


@router.get("/digest")
def digest():
    with connect() as conn:
        today = datetime.now().strftime("%a · %b %-d")

        sources_today = conn.execute(
            "SELECT COUNT(*) AS n FROM sources WHERE DATE(fetched_at) = DATE('now')"
        ).fetchone()["n"]
        pages_today = conn.execute(
            "SELECT COUNT(*) AS n FROM articles WHERE DATE(updated_at) = DATE('now')"
        ).fetchone()["n"]
        new_concepts = conn.execute(
            "SELECT COUNT(*) AS n FROM articles WHERE kind='Concept' AND DATE(created_at) >= DATE('now', '-7 day')"
        ).fetchone()["n"]
        open_qs = conn.execute(
            "SELECT COUNT(*) AS n FROM article_sections WHERE kind='open'"
        ).fetchone()["n"]

        # Build today's threads from real data: the articles updated today, grouped
        thread_rows = conn.execute(
            """SELECT id, title, summary, kind FROM articles
               WHERE DATE(updated_at) = DATE('now')
               ORDER BY updated_at DESC LIMIT 5"""
        ).fetchall()
        threads = [
            {
                "title": r["title"],
                "body": r["summary"] or "",
                "sources": conn.execute(
                    "SELECT COUNT(*) AS n FROM article_sources WHERE article_id = ?", (r["id"],)
                ).fetchone()["n"],
                "links": [
                    rr["label"] for rr in conn.execute(
                        """SELECT articles.title AS label FROM links
                           JOIN articles ON articles.id = links.to_article
                           WHERE links.from_article = ? ORDER BY weight DESC LIMIT 4""",
                        (r["id"],),
                    )
                ],
                "article_id": r["id"],
            }
            for r in thread_rows
        ]

        queue = [
            r["obj"]
            for r in conn.execute(
                "SELECT obj FROM feed WHERE verb IN ('queued','transcribing') ORDER BY ts DESC LIMIT 4"
            )
        ]

        summary = (
            f"{sources_today} sources read today, {pages_today} pages touched, "
            f"{new_concepts} new concept clusters this week."
        ) if (sources_today or pages_today or new_concepts) else (
            "Nothing new yet. Subscribe a feed or ask a question to get started."
        )

        return {
            "date": today,
            "summary": summary,
            "counters": [
                {"label": "Sources read",  "value": sources_today},
                {"label": "Pages touched", "value": pages_today},
                {"label": "New concepts",  "value": new_concepts},
                {"label": "Open questions","value": open_qs},
            ],
            "threads": threads,
            "queue": queue,
        }

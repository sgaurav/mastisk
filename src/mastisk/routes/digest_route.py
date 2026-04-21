"""Daily digest — what the agents did recently."""
from __future__ import annotations

from datetime import date as _date, datetime

from fastapi import APIRouter, HTTPException

from mastisk.db.queries import connect

router = APIRouter(tags=["digest"])


def _parse_date(s: str | None) -> _date:
    """Parse an ISO YYYY-MM-DD date; default to UTC today. 400 on bad input."""
    if s is None or s == "":
        return datetime.utcnow().date()
    try:
        return _date.fromisoformat(s)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid date: {s!r}") from e


@router.get("/digest")
def digest(date: str | None = None):
    d = _parse_date(date)
    d_iso = d.isoformat()
    with connect() as conn:
        label = d.strftime("%a · %b %-d")

        sources_today = conn.execute(
            "SELECT COUNT(*) AS n FROM sources WHERE DATE(fetched_at) = ?",
            (d_iso,),
        ).fetchone()["n"]
        pages_today = conn.execute(
            "SELECT COUNT(*) AS n FROM articles WHERE DATE(updated_at) = ?",
            (d_iso,),
        ).fetchone()["n"]
        # "New concepts this week" stays anchored on the requested day — the
        # week is the 7-day window ending on that date, so the counter makes
        # sense when you're time-travelling through old digests.
        new_concepts = conn.execute(
            """SELECT COUNT(*) AS n FROM articles
               WHERE kind='Concept'
                 AND DATE(created_at) >= DATE(?, '-7 day')
                 AND DATE(created_at) <= DATE(?)""",
            (d_iso, d_iso),
        ).fetchone()["n"]
        open_qs = conn.execute(
            "SELECT COUNT(*) AS n FROM article_sections WHERE kind='open'"
        ).fetchone()["n"]

        # Threads: the articles updated on this date
        thread_rows = conn.execute(
            """SELECT id, title, summary, kind FROM articles
               WHERE DATE(updated_at) = ?
               ORDER BY updated_at DESC LIMIT 5""",
            (d_iso,),
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
            f"{sources_today} sources read, {pages_today} pages touched, "
            f"{new_concepts} new concept clusters this week."
        ) if (sources_today or pages_today or new_concepts) else (
            f"No agent activity on {d_iso}."
        )

        # Nearest neighbouring dates with any article activity. Returns None
        # if there's no earlier/later day with touched articles, so the UI
        # can disable the arrows.
        prev_row = conn.execute(
            """SELECT DATE(updated_at) AS d FROM articles
               WHERE DATE(updated_at) < ?
               ORDER BY updated_at DESC LIMIT 1""",
            (d_iso,),
        ).fetchone()
        next_row = conn.execute(
            """SELECT DATE(updated_at) AS d FROM articles
               WHERE DATE(updated_at) > ?
               ORDER BY updated_at ASC LIMIT 1""",
            (d_iso,),
        ).fetchone()
        prev_date = prev_row["d"] if prev_row else None
        next_date = next_row["d"] if next_row else None

        return {
            "date": label,
            "iso_date": d_iso,
            "prev_date": prev_date,
            "next_date": next_date,
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

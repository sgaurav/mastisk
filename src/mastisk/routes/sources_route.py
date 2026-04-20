"""RSS feeds + source management."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from mastisk.db.queries import connect

router = APIRouter(tags=["sources"])


class FeedIn(BaseModel):
    url: str
    title: str | None = None


@router.get("/feeds")
def list_feeds():
    with connect() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT url, title, last_fetched, enabled FROM rss_feeds ORDER BY added_at DESC"
        )]
    return {"feeds": rows}


@router.post("/feeds")
def add_feed(feed: FeedIn):
    with connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO rss_feeds (url, title) VALUES (?, ?)",
            (feed.url, feed.title or feed.url),
        )
    return {"ok": True}


@router.delete("/feeds")
def remove_feed(url: str):
    with connect() as conn:
        conn.execute("DELETE FROM rss_feeds WHERE url = ?", (url,))
    return {"ok": True}

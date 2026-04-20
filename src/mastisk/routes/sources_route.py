"""RSS feeds + source management."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException
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
            """SELECT url, title, last_fetched, last_etag, last_modified, enabled, added_at,
                      (SELECT COUNT(*) FROM sources
                         WHERE sources.url LIKE '%' || rss_feeds.url || '%' OR 0=1) AS items_ever
               FROM rss_feeds ORDER BY added_at DESC"""
        )]
    # items_ever is a rough count; useful enough for dashboard
    for r in rows:
        r["enabled"] = bool(r["enabled"])
    return {"feeds": rows}


@router.post("/feeds")
def add_feed(feed: FeedIn):
    url = feed.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "url must start with http:// or https://")
    with connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO rss_feeds (url, title) VALUES (?, ?)",
            (url, feed.title or url),
        )
        row = conn.execute(
            "SELECT url, title, last_fetched, enabled, added_at FROM rss_feeds WHERE url = ?",
            (url,),
        ).fetchone()
    return {"ok": True, "feed": dict(row)}


@router.delete("/feeds")
def remove_feed(url: str):
    with connect() as conn:
        conn.execute("DELETE FROM rss_feeds WHERE url = ?", (url,))
    return {"ok": True}


@router.post("/feeds/toggle")
def toggle_feed(feed: FeedIn):
    with connect() as conn:
        conn.execute(
            "UPDATE rss_feeds SET enabled = 1 - enabled WHERE url = ?", (feed.url,)
        )
    return {"ok": True}


@router.post("/feeds/fetch")
async def fetch_now(feed: FeedIn, background: BackgroundTasks):
    """Run Scout against a specific feed right now (background task).

    The UI can call this when the user clicks "fetch now" on a feed row.
    """
    from mastisk.agents.scout import Scout

    with connect() as conn:
        exists = conn.execute("SELECT 1 FROM rss_feeds WHERE url = ?", (feed.url,)).fetchone()
        if not exists:
            raise HTTPException(404, "feed not subscribed")

    async def run():
        await Scout()._fetch_feed(feed.url)

    background.add_task(run)
    return {"ok": True, "queued": feed.url}


@router.get("/sources")
def list_sources(limit: int = 50):
    with connect() as conn:
        rows = [dict(r) for r in conn.execute(
            """SELECT id, kind, url, title, published_at, fetched_at, author
               FROM sources ORDER BY fetched_at DESC LIMIT ?""",
            (limit,),
        )]
    return {"sources": rows}


@router.get("/jobs")
def list_jobs(limit: int = 50):
    with connect() as conn:
        rows = [dict(r) for r in conn.execute(
            """SELECT id, agent, kind, status, attempts, created_at, started_at, finished_at, error, payload_json
               FROM jobs ORDER BY id DESC LIMIT ?""",
            (limit,),
        )]
    return {"jobs": rows}

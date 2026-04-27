"""Ad-hoc URL ingestion — drop a single blog/article URL into the wiki.

Used by ``/api/listen`` when a pasted URL classifies as 'unknown' (i.e.
not audio/video/feed). Mirrors the per-entry blog ingestion that Scout
does for RSS items, but for a single ad-hoc URL — no feed needed.

Pipeline: httpx fetch -> trafilatura body extraction -> minimal sources
row -> enqueue compiler/compile.
"""
from __future__ import annotations

import hashlib
import logging
import re
from html import unescape

import httpx
import trafilatura

from mastisk.agents.base import enqueue
from mastisk.agents.scout import HTTP_TIMEOUT, USER_AGENT, _first_img_in_html
from mastisk.db.queries import connect
from mastisk.paths import raw_dir

log = logging.getLogger("mastisk.web")

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


async def ingest_url(url: str, *, title: str | None = None) -> dict:
    """Fetch, extract, persist, enqueue. Returns
    ``{source_id, job_id, title, dedup}``.

    On dedup (URL already in ``sources``) ``job_id`` is None and ``dedup``
    is True — caller surfaces the existing source.

    Raises RuntimeError with a human-readable message on fetch/extract
    failure; the route turns that into a 400.
    """
    src_id = hashlib.sha256(url.encode()).hexdigest()[:16]

    # Dedup before any network work.
    with connect() as conn:
        row = conn.execute(
            "SELECT id, title FROM sources WHERE id = ? OR url = ?",
            (src_id, url),
        ).fetchone()
    if row:
        return {
            "source_id": row["id"],
            "job_id": None,
            "title": row["title"] or url,
            "dedup": True,
        }

    # Fetch.
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as c:
            resp = await c.get(url, headers={"User-Agent": USER_AGENT})
    except Exception as e:
        raise RuntimeError(f"couldn't fetch {url}: {e}") from e
    if resp.status_code >= 400:
        raise RuntimeError(f"{url} returned HTTP {resp.status_code}")

    page_html = resp.text

    # Extract body. trafilatura returns None on extraction failure; fall back
    # to a stripped version of the page so the Compiler at least has *something*.
    body = trafilatura.extract(
        page_html, include_comments=False, include_tables=False,
    ) or _strip_tags(page_html)
    if not (body or "").strip():
        raise RuntimeError(
            f"couldn't extract any text from {url}. Page may be JS-rendered, "
            "paywalled, or empty."
        )

    # Title: explicit param > <title> tag > URL.
    extracted_title = title or _extract_title(page_html) or url
    hero = _first_img_in_html(page_html)

    raw_path = raw_dir() / f"{src_id}.txt"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(f"# {extracted_title}\n\n{url}\n\n{body}", encoding="utf-8")

    with connect() as conn:
        conn.execute(
            """INSERT INTO sources
                  (id, kind, url, title, raw_path, hero_image_url)
               VALUES (?, 'blog', ?, ?, ?, ?)""",
            (src_id, url, extracted_title, str(raw_path), hero),
        )

    job_id = enqueue("compiler", "compile", {"source_id": src_id})
    log.info("web.ingest_url: queued compile for %s (source=%s, job=%s)", url, src_id, job_id)

    return {
        "source_id": src_id,
        "job_id": job_id,
        "title": extracted_title,
        "dedup": False,
    }


def _extract_title(html: str) -> str | None:
    m = _TITLE_RE.search(html or "")
    if not m:
        return None
    title = unescape(m.group(1)).strip()
    title = re.sub(r"\s+", " ", title)
    return title or None


def _strip_tags(html: str) -> str:
    """Brutal HTML-to-text fallback. Only used when trafilatura returns
    nothing — usually means the page is mostly JS-rendered and there's
    nothing meaningful to extract anyway."""
    no_scripts = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html or "",
                        flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<[^>]+>", " ", no_scripts)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()

"""OpenLibrary search + cover URL helper. No auth, no rate limiting beyond timeout."""
from __future__ import annotations

import json
import logging
from difflib import SequenceMatcher

import httpx

log = logging.getLogger("mastisk.openlibrary")

_UA = "Mastisk/0.1 (knowledge-wiki; personal use)"
_SEARCH_URL = "https://openlibrary.org/search.json"


async def search_book(
    title: str,
    author: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict | None:
    """Search OpenLibrary for the best match. Returns normalized dict or None."""
    if not title or not title.strip():
        return None
    params = {
        "title": title,
        "fields": "key,title,author_name,isbn,cover_i,first_publish_year,edition_count,subject",
        "limit": "5",
    }
    if author:
        params["author"] = author

    own = client is None
    c = client or httpx.AsyncClient(timeout=10.0, headers={"User-Agent": _UA})
    try:
        try:
            resp = await c.get(_SEARCH_URL, params=params)
        except Exception as e:
            log.info("openlibrary: network error for %r: %s", title, e)
            return None
    finally:
        if own:
            await c.aclose()

    if resp.status_code != 200:
        log.info("openlibrary: %s for %r", resp.status_code, title)
        return None
    try:
        data = resp.json()
    except json.JSONDecodeError:
        return None
    docs = data.get("docs") or []
    if not docs:
        return None
    best = _pick_best(docs, author)
    if not best:
        return None
    cover_i = best.get("cover_i")
    # Filter Nones at the boundary — OpenLibrary occasionally emits null entries
    # in author_name/subject. Every downstream consumer expects list[str].
    return {
        "title": best.get("title") or title,
        "authors": [a for a in (best.get("author_name") or []) if a],
        "year": best.get("first_publish_year"),
        "cover_url": f"https://covers.openlibrary.org/b/id/{cover_i}-L.jpg" if cover_i else None,
        "subjects": [s for s in (best.get("subject") or []) if s][:20],
        "ol_work_key": best.get("key") or "",
    }


def _pick_best(docs: list[dict], author: str | None) -> dict | None:
    """Prefer docs that have a cover image and high edition_count. If an author
    is given, require author similarity > 0.5 against at least one listed
    author_name.

    If an author was supplied and no candidate clears the similarity bar,
    return None — producing a wrong-author pre-stub is worse than producing
    no pre-stub. The book will still be listed in the raw transcript.
    If no author was supplied, fall back to the top doc so the common "just
    a title" case still enriches.
    """
    candidates: list[tuple[float, dict]] = []
    for d in docs:
        editions = int(d.get("edition_count") or 0)
        has_cover = 1 if d.get("cover_i") else 0
        author_score = 1.0
        if author:
            names = d.get("author_name") or []
            author_score = max(
                (SequenceMatcher(None, author.lower(), (n or "").lower()).ratio() for n in names),
                default=0.0,
            )
            if author_score <= 0.5:
                continue
        # Composite rank — cover presence is worth a lot, then editions, then author sim.
        score = has_cover * 10_000 + editions + author_score
        candidates.append((score, d))
    if not candidates:
        if author:
            return None
        return docs[0] if docs else None
    candidates.sort(key=lambda t: t[0], reverse=True)
    return candidates[0][1]

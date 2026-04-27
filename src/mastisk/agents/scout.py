"""Scout — polls RSS feeds, clips relevant items, enqueues Compiler jobs.

Interest-gating: a new item's title + summary is compared against `vault/_self/interests.md`
via Ollama embeddings. Items with cosine sim < 0.25 to any interest line AND matching a
dislikes keyword are skipped (and emit a "Scout filtered: …" feed entry).
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime

import feedparser
import httpx
import trafilatura

from mastisk.agents.base import Agent, enqueue
from mastisk.db import queries as q
from mastisk.db.queries import connect
from mastisk.paths import raw_dir, self_dir

log = logging.getLogger("mastisk.scout")

# Relevance thresholds (tuned conservatively; easy to edit in one place)
SIM_THRESHOLD = 0.25

USER_AGENT = "Mastisk/0.1 (personal knowledge wiki; RSS reader)"
HTTP_TIMEOUT = httpx.Timeout(connect=8.0, read=25.0, write=15.0, pool=5.0)
_DEFAULT_FIRST_POLL = 3  # processed on the very first poll if backfill_remaining was 0


class Scout(Agent):
    name = "scout"
    tick_seconds = 600  # 10 min

    async def _handle(self, job: dict) -> None:
        payload = json.loads(job["payload_json"] or "{}")
        feed_url = payload.get("url")
        if not feed_url:
            with connect() as conn:
                row = conn.execute(
                    """SELECT url FROM subscriptions WHERE enabled=1
                       AND (last_fetched IS NULL OR last_fetched < datetime('now', '-1 hour'))
                       ORDER BY last_fetched ASC LIMIT 1"""
                ).fetchone()
                if not row:
                    return
                feed_url = row["url"]

        await self._fetch_feed(feed_url)

    async def run_once(self) -> None:
        """Scout is different from the default pick-one-job loop: it tick-polls the DB for feeds."""
        # If there are queued scout jobs, process one; otherwise auto-poll a subscription
        job = self._pick_job()
        if job:
            return await super().run_once()
        with connect() as conn:
            row = conn.execute(
                """SELECT url FROM subscriptions WHERE enabled=1
                   AND (last_fetched IS NULL OR last_fetched < datetime('now', '-1 hour'))
                   ORDER BY last_fetched ASC LIMIT 1"""
            ).fetchone()
        if row:
            try:
                await self._fetch_feed(row["url"])
            except Exception:
                log.exception("scout auto-poll failed")

    async def _fetch_feed(self, feed_url: str) -> None:
        """Fetch a feed with HTTP conditional-GET — we only re-parse if changed."""
        log.info("scout fetching %s", feed_url)

        # Load cached conditional headers
        with connect() as conn:
            row = conn.execute(
                "SELECT last_etag, last_modified FROM subscriptions WHERE url=?", (feed_url,)
            ).fetchone()
        headers = {"User-Agent": USER_AGENT}
        if row:
            if row["last_etag"]:
                headers["If-None-Match"] = row["last_etag"]
            if row["last_modified"]:
                headers["If-Modified-Since"] = row["last_modified"]

        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
                resp = await client.get(feed_url, headers=headers)
        except Exception as e:
            log.warning("scout: network error on %s: %s", feed_url, e)
            with connect() as conn:
                conn.execute(
                    "UPDATE subscriptions SET last_fetched=CURRENT_TIMESTAMP, last_error=? WHERE url=?",
                    (str(e)[:500], feed_url),
                )
            self.emit_feed(verb="failed", obj=feed_url[:80], kind="rss", payload={"error": str(e)[:200]})
            return

        # Always record that we tried
        new_etag = resp.headers.get("etag")
        new_last_mod = resp.headers.get("last-modified")
        with connect() as conn:
            conn.execute(
                """UPDATE subscriptions
                     SET last_fetched=CURRENT_TIMESTAMP,
                         last_etag=COALESCE(?, last_etag),
                         last_modified=COALESCE(?, last_modified),
                         last_error=NULL
                   WHERE url=?""",
                (new_etag, new_last_mod, feed_url),
            )

        if resp.status_code == 304:
            log.info("scout: %s unchanged (304)", feed_url)
            self.emit_feed(verb="checked", obj=feed_url[:80], kind="rss", payload={"status": "not_modified"})
            return
        if resp.status_code >= 400:
            log.warning("scout: %s returned %s", feed_url, resp.status_code)
            self.emit_feed(verb="failed", obj=feed_url[:80], kind="rss", payload={"status": resp.status_code})
            return

        parsed = feedparser.parse(resp.content)
        if parsed.bozo and not parsed.entries:
            log.warning("scout: malformed feed %s: %s", feed_url, parsed.bozo_exception)
            return

        # Load the subscription row so we know the kind, pointer, and limits.
        with connect() as conn:
            sub_row = conn.execute(
                "SELECT * FROM subscriptions WHERE url=?", (feed_url,)
            ).fetchone()
            sub = dict(sub_row) if sub_row else None
        if sub is None:
            # Fall back to legacy RSS path for callers that pass a non-subscription URL.
            sub = {"kind": "rss", "url": feed_url, "title": feed_url,
                   "last_seen_guid": None, "backfill_remaining": 0,
                   "max_per_poll": 20, "bypass_interest_gate": 0}

        kind = sub.get("kind") or "rss"

        # Diff: trim entries to those newer than last_seen_guid; cap by backfill (first poll)
        # or max_per_poll (subsequent polls). Entries are typically newest-first in feeds.
        new_entries = _entries_after(parsed.entries, sub.get("last_seen_guid"))
        if sub.get("last_seen_guid") is None:
            limit = max(int(sub.get("backfill_remaining") or 0), 0) or _DEFAULT_FIRST_POLL
        else:
            limit = max(int(sub.get("max_per_poll") or 5), 1)
        new_entries = new_entries[:limit]

        if not new_entries:
            log.info("scout: %s no new entries", feed_url)
            self.emit_feed(verb="checked", obj=(sub.get("title") or feed_url)[:80],
                           kind=kind, payload={"status": "no_new", "subscription_url": feed_url})
            return

        if kind == "rss":
            interests = self._load_interests()
            dislikes = self._load_dislikes()
            new_count = await self._ingest_rss_entries(sub, new_entries, interests, dislikes)
        elif kind == "youtube":
            new_count = self._ingest_youtube_entries(sub, new_entries)
        elif kind == "podcast":
            new_count = self._ingest_podcast_entries(sub, new_entries)
        else:
            log.warning("scout: unknown subscription kind %s for %s", kind, feed_url)
            new_count = 0

        # Advance the diff pointer to the newest GUID we just saw.
        newest_guid = _entry_guid(parsed.entries[0]) if parsed.entries else None
        if newest_guid:
            with connect() as conn:
                conn.execute(
                    """UPDATE subscriptions
                          SET last_seen_guid = ?,
                              backfill_remaining = MAX(0, backfill_remaining - ?)
                        WHERE url = ?""",
                    (newest_guid, len(new_entries), feed_url),
                )

        log.info("scout: %s -> %s new items (%s)", feed_url, new_count, kind)


    # ───── per-kind ingest helpers ─────

    async def _ingest_rss_entries(
        self, sub: dict, entries: list, interests: list[str], dislikes: list[str],
    ) -> int:
        """Existing RSS path: fetch + extract page content, write a sources row,
        enqueue compiler. Honors interest/dislike gates unless bypass is set."""
        new_count = 0
        bypass = bool(sub.get("bypass_interest_gate"))
        with connect() as conn:
            for entry in entries:
                link = entry.get("link", "")
                if not link:
                    continue
                title = entry.get("title", "")
                summary = entry.get("summary", "") or entry.get("description", "")

                exists = conn.execute("SELECT id FROM sources WHERE url=?", (link,)).fetchone()
                if exists:
                    continue

                if not bypass:
                    if self._is_disliked(title, summary, dislikes):
                        self.emit_feed(verb="filtered", obj=title[:80], kind="rss",
                                       payload={"why": "dislikes match", "subscription_url": sub["url"]})
                        continue
                    if not await self._score_relevance(f"{title}\n{summary}", interests):
                        self.emit_feed(verb="filtered", obj=title[:80], kind="rss",
                                       payload={"why": "below threshold", "subscription_url": sub["url"]})
                        continue

                body = summary
                page_html: str | None = None
                try:
                    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as c:
                        page = await c.get(link, headers={"User-Agent": USER_AGENT})
                        if page.status_code < 400:
                            page_html = page.text
                            extracted = trafilatura.extract(
                                page.text, include_comments=False, include_tables=False,
                            )
                            if extracted:
                                body = extracted
                except Exception as e:
                    log.info("scout extract failed for %s: %s", link, e)

                src_id = hashlib.sha256(link.encode()).hexdigest()[:16]
                raw_path = raw_dir() / f"{src_id}.txt"
                raw_path.parent.mkdir(parents=True, exist_ok=True)
                raw_path.write_text(f"# {title}\n\n{link}\n\n{body}")

                published = entry.get("published_parsed")
                published_iso = datetime(*published[:6]).isoformat(sep=" ") if published else None

                hero = _pick_entry_thumbnail(entry) \
                    or _first_img_in_html(summary) \
                    or (_first_img_in_html(page_html) if page_html else None)
                inline_media = _extract_inline_images(page_html, link, limit=6) if page_html else []
                if hero:
                    inline_media = [m for m in inline_media if m.get("src") != hero]

                conn.execute(
                    """INSERT INTO sources
                       (id, kind, url, title, published_at, raw_path, author,
                        hero_image_url, media_json)
                       VALUES (?, 'blog', ?, ?, ?, ?, ?, ?, ?)""",
                    (src_id, link, title, published_iso, str(raw_path),
                     entry.get("author"), hero,
                     json.dumps(inline_media) if inline_media else None),
                )
                enqueue("compiler", kind="compile",
                        payload={"source_id": src_id, "subscription_url": sub["url"]})
                self.emit_feed(verb="clipped", obj=title[:80], kind="blog",
                               payload={"source_id": src_id, "subscription_url": sub["url"]})
                new_count += 1
        return new_count

    def _ingest_youtube_entries(self, sub: dict, entries: list) -> int:
        """Queue each new video for the Listener (transcribe job kind)."""
        n = 0
        for entry in entries:
            video_url = entry.get("link") or entry.get("id")
            if not video_url:
                continue
            title = entry.get("title", "")
            enqueue("listener", kind="transcribe", payload={
                "url": video_url,
                "subscription_url": sub["url"],
            })
            self.emit_feed(verb="queued", obj=title[:80], kind="youtube",
                           payload={"url": video_url, "subscription_url": sub["url"]})
            n += 1
        return n

    def _ingest_podcast_entries(self, sub: dict, entries: list) -> int:
        """Queue each new episode for the Listener (transcribe_audio job kind)."""
        n = 0
        for entry in entries:
            enclosure = next(
                (e for e in (entry.get("enclosures") or [])
                 if (e.get("type") or "").startswith("audio/")),
                None,
            )
            if not enclosure or not enclosure.get("href"):
                continue
            published = entry.get("published_parsed")
            published_iso = datetime(*published[:6]).isoformat(sep=" ") if published else None
            enqueue("listener", kind="transcribe_audio", payload={
                "audio_url": enclosure["href"],
                "episode_title": entry.get("title", ""),
                "show_title": sub.get("title") or "",
                "published_at": published_iso,
                "feed_url": sub["url"],
                "subscription_url": sub["url"],
            })
            self.emit_feed(
                verb="queued",
                obj=(entry.get("title") or sub.get("title") or "")[:80],
                kind="podcast",
                payload={"audio_url": enclosure["href"], "subscription_url": sub["url"]},
            )
            n += 1
        return n

    # ───── interest/dislike handling ─────

    def _load_interests(self) -> list[str]:
        p = self_dir() / "interests.md"
        if not p.exists():
            return []
        return [re.sub(r"^[-*•\d.\s]+", "", line).strip() for line in p.read_text().splitlines()
                if line.strip() and not line.lstrip().startswith("#")]

    def _load_dislikes(self) -> list[str]:
        p = self_dir() / "dislikes.md"
        if not p.exists():
            return []
        words: list[str] = []
        for line in p.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith("#"):
                cleaned = re.sub(r"^[-*•\d.\s]+", "", line).strip().lower()
                if cleaned:
                    words.append(cleaned)
        return words

    def _is_disliked(self, title: str, summary: str, dislikes: list[str]) -> bool:
        hay = f"{title} {summary}".lower()
        return any(kw and kw in hay for kw in dislikes)

    async def _score_relevance(self, text: str, interests: list[str]) -> bool:
        """True if text is relevant to any interest. If no interests file, accept everything."""
        if not interests:
            return True
        try:
            from mastisk.bridges import ollama_bridge
            vectors = await ollama_bridge.embed([text] + interests)
            if not vectors or len(vectors) < 2:
                return True  # fail-open
            item_vec = vectors[0]
            max_sim = max(ollama_bridge.cosine(item_vec, v) for v in vectors[1:])
            return max_sim >= SIM_THRESHOLD
        except Exception as e:
            log.info("scout embed failed, fail-open: %s", e)
            return True


# ───── image-extraction helpers ─────

_IMG_RE = re.compile(
    r'<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|\'([^\']+)\'|([^\s>]+))[^>]*>',
    re.IGNORECASE,
)
_IMG_ALT_RE = re.compile(r'\balt\s*=\s*(?:"([^"]*)"|\'([^\']*)\')', re.IGNORECASE)


def _pick_entry_thumbnail(entry: dict) -> str | None:
    """RSS entry-level thumbnail. Most feeds use ``media_thumbnail`` (mRSS)
    or ``media_content``; some stuff an image into the entry directly."""
    for mt in entry.get("media_thumbnail") or []:
        href = mt.get("url") if isinstance(mt, dict) else None
        if href:
            return href
    for mc in entry.get("media_content") or []:
        if not isinstance(mc, dict):
            continue
        if (mc.get("medium") or "").lower() == "image" and mc.get("url"):
            return mc["url"]
        # Some feeds omit medium; trust the extension.
        url = mc.get("url") or ""
        if url.lower().split("?", 1)[0].endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
            return url
    image = entry.get("image")
    if isinstance(image, dict):
        href = image.get("href") or image.get("url")
        if href:
            return href
    return None


def _first_img_in_html(html: str | None) -> str | None:
    """Return the first ``<img src>`` value in an HTML fragment, or None."""
    if not html:
        return None
    m = _IMG_RE.search(html)
    if not m:
        return None
    return m.group(1) or m.group(2) or m.group(3) or None


def _extract_inline_images(html: str | None, base_url: str, *, limit: int) -> list[dict]:
    """Collect up to ``limit`` distinct ``<img>`` URLs from ``html``.

    Resolves relative URLs against ``base_url`` and skips obvious tracking
    pixels (1x1, data URIs). Order follows document order. Returned dicts
    match the frontend ``Article.media`` shape: ``{src, alt, caption?}``.
    """
    if not html:
        return []
    from urllib.parse import urljoin

    seen: set[str] = set()
    out: list[dict] = []
    for m in _IMG_RE.finditer(html):
        src = m.group(1) or m.group(2) or m.group(3)
        if not src:
            continue
        if src.startswith("data:"):
            continue
        absolute = urljoin(base_url, src)
        if absolute in seen:
            continue
        seen.add(absolute)
        # Pull an alt attribute out of the same tag if present. Cheap — we're
        # already iterating over the matched substring.
        alt_match = _IMG_ALT_RE.search(m.group(0))
        alt = (alt_match.group(1) or alt_match.group(2)) if alt_match else ""
        out.append({"src": absolute, "alt": alt})
        if len(out) >= limit:
            break
    return out


def _entry_guid(entry: dict) -> str | None:
    """Best-effort stable identifier for a feed entry. Atom feeds use <id>;
    YouTube's RSS uses yt:videoId; podcast RSS uses <guid>; others fall back
    to the link/URL."""
    return (
        entry.get("yt_videoid")
        or entry.get("id")
        or entry.get("guid")
        or entry.get("link")
        or None
    )


def _entries_after(entries: list, last_seen_guid: str | None) -> list:
    """Return entries newer than the pointer. Feeds are typically newest-first;
    we trust that ordering and slice on the first match. If the pointer isn't
    found we treat all entries as new (caller will cap by backfill/max_per_poll)."""
    if not last_seen_guid or not entries:
        return list(entries)
    out = []
    for e in entries:
        if _entry_guid(e) == last_seen_guid:
            break
        out.append(e)
    return out

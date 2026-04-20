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


class Scout(Agent):
    name = "scout"
    tick_seconds = 600  # 10 min

    async def _handle(self, job: dict) -> None:
        payload = json.loads(job["payload_json"] or "{}")
        feed_url = payload.get("url")
        if not feed_url:
            # Default path: pick one enabled feed that hasn't been fetched in an hour
            with connect() as conn:
                row = conn.execute(
                    """SELECT url FROM rss_feeds WHERE enabled=1
                       AND (last_fetched IS NULL OR last_fetched < datetime('now', '-1 hour'))
                       ORDER BY last_fetched ASC LIMIT 1"""
                ).fetchone()
                if not row:
                    return
                feed_url = row["url"]

        await self._fetch_feed(feed_url)

    async def run_once(self) -> None:
        """Scout is different from the default pick-one-job loop: it tick-polls the DB for feeds."""
        # If there are queued scout jobs, process one; otherwise auto-poll a feed
        job = self._pick_job()
        if job:
            return await super().run_once()
        # Auto-poll
        with connect() as conn:
            row = conn.execute(
                """SELECT url FROM rss_feeds WHERE enabled=1
                   AND (last_fetched IS NULL OR last_fetched < datetime('now', '-1 hour'))
                   ORDER BY last_fetched ASC LIMIT 1"""
            ).fetchone()
        if row:
            try:
                await self._fetch_feed(row["url"])
            except Exception:
                log.exception("scout auto-poll failed")

    async def _fetch_feed(self, feed_url: str) -> None:
        log.info("scout fetching %s", feed_url)
        # feedparser is sync; offload? For a small RSS fetch it's fine in-line
        parsed = feedparser.parse(feed_url)
        if parsed.bozo and not parsed.entries:
            log.warning("scout: malformed feed %s: %s", feed_url, parsed.bozo_exception)
            return

        interests = self._load_interests()
        dislikes = self._load_dislikes()
        new_count = 0

        with connect() as conn:
            conn.execute(
                "UPDATE rss_feeds SET last_fetched=CURRENT_TIMESTAMP WHERE url=?", (feed_url,),
            )
            for entry in parsed.entries[:20]:
                link = entry.get("link", "")
                if not link:
                    continue
                title = entry.get("title", "")
                summary = entry.get("summary", "") or entry.get("description", "")

                # De-dupe by URL
                exists = conn.execute("SELECT id FROM sources WHERE url=?", (link,)).fetchone()
                if exists:
                    continue

                if self._is_disliked(title, summary, dislikes):
                    self.emit_feed(verb="filtered", obj=title[:80], kind="rss", payload={"why": "dislikes match"})
                    continue

                relevant = await self._score_relevance(f"{title}\n{summary}", interests)
                if not relevant:
                    self.emit_feed(verb="filtered", obj=title[:80], kind="rss", payload={"why": "below threshold"})
                    continue

                # Fetch + extract clean text
                try:
                    body = trafilatura.extract(
                        trafilatura.fetch_url(link) or "",
                        include_comments=False,
                        include_tables=False,
                    ) or summary
                except Exception as e:
                    log.info("scout extract failed for %s: %s", link, e)
                    body = summary

                src_id = hashlib.sha256(link.encode()).hexdigest()[:16]
                raw_path = raw_dir() / f"{src_id}.txt"
                raw_path.parent.mkdir(parents=True, exist_ok=True)
                raw_path.write_text(f"# {title}\n\n{link}\n\n{body}")

                published = entry.get("published_parsed")
                published_iso = datetime(*published[:6]).isoformat(sep=" ") if published else None

                conn.execute(
                    """INSERT INTO sources (id, kind, url, title, published_at, raw_path, author)
                       VALUES (?, 'blog', ?, ?, ?, ?, ?)""",
                    (src_id, link, title, published_iso, str(raw_path), entry.get("author")),
                )
                enqueue("compiler", kind="compile", payload={"source_id": src_id})
                self.emit_feed(verb="clipped", obj=title[:80], kind="blog", payload={"source_id": src_id})
                new_count += 1

        log.info("scout: %s new sources from %s", new_count, feed_url)

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

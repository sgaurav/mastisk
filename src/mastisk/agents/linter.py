"""Linter — periodic health checker for the wiki.

Deterministic passes (no LLM needed):

- Dangling wiki links: ``<span class="link" data-target="slug">`` in any
  article body whose ``slug`` doesn't exist in ``articles``.
- Orphans: articles with zero incoming + zero outgoing links (excluding
  self-links).
- Empty articles: no sections or only empty section bodies.
- Unresolved related links: the Compiler drops related-link targets that
  don't exist yet. When a sibling article later appears, we try to
  reconnect it.

Findings emit ``feed`` rows with ``verb="flagged"`` / ``"cleaned"`` so the
Agents view and live rail surface them. We don't block on an LLM — if
``summarize_model_cheap`` is reachable we ask it to write a one-line
suggestion per flagged article; if not, we just emit the structural finding.
"""
from __future__ import annotations

import asyncio
import logging
import re

from mastisk.agents.base import Agent
from mastisk.bridges import ollama_bridge
from mastisk.db.queries import connect

log = logging.getLogger("mastisk.linter")

LINK_RE = re.compile(r'<span class="link"\s+data-target="([^"]+)"[^>]*>')


class Linter(Agent):
    name = "linter"
    tick_seconds = 900  # 15 min

    # Cap per-tick advisory LLM calls so a large vault doesn't grind the
    # local model. The structural pass always runs; the LLM pass is best-effort.
    max_llm_suggestions = 5

    async def run_once(self) -> None:
        # Linter usually has no queued work — its tick IS its scan. We still
        # drain any externally-queued jobs (future: targeted re-lints of a
        # single article id).
        job = self._pick_job()
        if job:
            self._mark_running(job["id"])
            try:
                await self._handle(job)
                self._mark_done(job["id"])
            except Exception as e:
                log.exception("linter: job %s failed", job["id"])
                self._mark_failed(job["id"], str(e))

        await self._scan()

    async def _handle(self, job: dict) -> None:
        # Targeted re-scan of a single article: payload {"article_id": "..."}
        import json
        payload = json.loads(job.get("payload_json") or "{}")
        article_id = payload.get("article_id")
        if not article_id:
            return
        await self._scan(article_id=article_id)

    async def _scan(self, *, article_id: str | None = None) -> None:
        with connect() as conn:
            if article_id:
                articles = conn.execute(
                    "SELECT id, title, body_md FROM articles WHERE id = ?", (article_id,)
                ).fetchall()
            else:
                articles = conn.execute(
                    "SELECT id, title, body_md FROM articles"
                ).fetchall()
            known_ids = {
                r["id"] for r in conn.execute("SELECT id FROM articles")
            }

        findings = []
        reconnected = 0

        for row in articles:
            body = row["body_md"] or ""
            with connect() as conn:
                sections = [
                    dict(r) for r in conn.execute(
                        "SELECT heading, body FROM article_sections WHERE article_id = ?",
                        (row["id"],),
                    )
                ]

            dangling = self._dangling_targets(sections, known_ids, self_id=row["id"])
            if dangling:
                findings.append({"kind": "dangling", "article_id": row["id"],
                                 "title": row["title"], "targets": dangling})

            # Reconnect unresolved related links: for every link target referenced
            # in the body that exists as an article, make sure a row exists in
            # the `links` table. The Compiler originally dropped these when the
            # sibling hadn't been written yet.
            resolved = self._resolvable_in_body(sections, known_ids, self_id=row["id"])
            if resolved:
                with connect() as conn:
                    before = conn.execute(
                        "SELECT COUNT(*) AS n FROM links WHERE from_article = ?",
                        (row["id"],),
                    ).fetchone()["n"]
                    for target in resolved:
                        conn.execute(
                            """INSERT OR IGNORE INTO links
                               (from_article, to_article, weight, snippet)
                               VALUES (?, ?, 0.5, ?)""",
                            (row["id"], target, "[linter] resolved from body"),
                        )
                    after = conn.execute(
                        "SELECT COUNT(*) AS n FROM links WHERE from_article = ?",
                        (row["id"],),
                    ).fetchone()["n"]
                    reconnected += max(0, after - before)

            if self._is_empty(sections, body):
                findings.append({"kind": "empty", "article_id": row["id"], "title": row["title"]})

        orphans = self._orphans() if article_id is None else []
        for o in orphans:
            findings.append({"kind": "orphan", "article_id": o["id"], "title": o["title"]})

        # Emit structural findings.
        for f in findings:
            obj = (f.get("title") or f["article_id"])[:80]
            self.emit_feed(verb="flagged", obj=obj, kind=f["kind"], payload=f)

        if reconnected:
            self.emit_feed(
                verb="cleaned", obj=f"{reconnected} links reconnected",
                kind="reconnect", touched=reconnected, payload={"count": reconnected},
            )

        # Best-effort advisory LLM pass on a handful of flagged items.
        advisories = [f for f in findings if f["kind"] in ("empty", "orphan")][: self.max_llm_suggestions]
        if advisories:
            await self._llm_advise(advisories)

    # ───── pure checks ─────

    def _dangling_targets(self, sections: list[dict], known: set[str], *, self_id: str) -> list[str]:
        seen: set[str] = set()
        for s in sections:
            for m in LINK_RE.finditer(s.get("body", "") or ""):
                t = m.group(1)
                if t and t != self_id and t not in known:
                    seen.add(t)
        return sorted(seen)

    def _resolvable_in_body(self, sections: list[dict], known: set[str], *, self_id: str) -> list[str]:
        seen: set[str] = set()
        for s in sections:
            for m in LINK_RE.finditer(s.get("body", "") or ""):
                t = m.group(1)
                if t and t != self_id and t in known:
                    seen.add(t)
        return sorted(seen)

    def _is_empty(self, sections: list[dict], body_md: str) -> bool:
        if not sections:
            return not body_md.strip()
        return all(not (s.get("body") or "").strip() for s in sections)

    def _orphans(self) -> list[dict]:
        with connect() as conn:
            rows = conn.execute(
                """SELECT a.id, a.title FROM articles a
                   WHERE (SELECT COUNT(*) FROM links
                             WHERE from_article = a.id AND to_article != a.id) = 0
                     AND (SELECT COUNT(*) FROM links
                             WHERE to_article = a.id AND from_article != a.id) = 0
                   ORDER BY a.updated_at DESC LIMIT 10"""
            ).fetchall()
        return [dict(r) for r in rows]

    # ───── advisory pass (cheap local model) ─────

    async def _llm_advise(self, items: list[dict]) -> None:
        """Ask the cheap local model for a one-line fix suggestion per item.

        Fails open — if Ollama is unreachable, we just skip this pass. The
        structural findings are already emitted above.
        """
        for item in items:
            try:
                prompt = (
                    f"You are advising a wiki janitor. An article titled {item['title']!r} "
                    f"was flagged as {item['kind']!r}. Suggest one concrete next step in "
                    f"<= 20 words. Plain text, no markdown, no preamble."
                )
                reply = await asyncio.wait_for(
                    ollama_bridge.chat(prompt, cheap=True), timeout=30,
                )
                if reply:
                    self.emit_feed(
                        verb="advised",
                        obj=item["title"][:80],
                        kind=item["kind"],
                        payload={"article_id": item["article_id"], "suggestion": reply.strip()[:400]},
                    )
            except Exception as e:
                log.info("linter advisory skipped: %s", e)
                break  # one failure means the model is down; don't hammer it

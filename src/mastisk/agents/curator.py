"""Curator agent — runs the Discover pipeline.

Tick interval is 1 hour; the *real* cadence is enforced by an internal
"is due" check against `DiscoverSettings.cadence_hours`. This means the
user can change cadence in Settings without restarting the daemon.

A single cycle:
  1. fan out to the 4 signal modules (co_citation, substack_recs,
     hn_leaderboard, arxiv_graph) in parallel
  2. merge candidates by canonical URL, summing confluence and
     concatenating trust paths
  3. drop already-subscribed / dislikes / blocked / sub-confluence rows
  4. take top 50 by confluence
  5. (optional) Claude relevance pass; keep score ≥ 7
  6. cap to settings.discover.max_per_cycle
  7. INSERT into `discoveries`
"""
from __future__ import annotations

import asyncio
import itertools
import logging
import re
from datetime import datetime, timezone
from typing import ClassVar
from urllib.parse import urlparse

from mastisk.agents.base import Agent
from mastisk.db import queries as q
from mastisk.db.queries import connect
from mastisk.integrations.discover import (
    Candidate,
    arxiv_graph,
    co_citation,
    hn_leaderboard,
    llm_judge,
    normalize_domain,
    substack_recs,
)
from mastisk.paths import self_dir
from mastisk.settings import get_settings

log = logging.getLogger("mastisk.curator")


class Curator(Agent):
    name: ClassVar[str] = "curator"
    tick_seconds: ClassVar[int] = 60 * 60   # check hourly; internal "is due" gates real cadence

    async def _handle(self, job: dict) -> None:
        """Curator is poll-driven, not job-driven, but we honor any queued
        manual-trigger jobs (kind='run') by forcing a cycle."""
        await self._cycle(force=True)

    async def run_once(self) -> None:
        """Override: prefer queued manual-trigger jobs; otherwise check cadence."""
        job = self._pick_job()
        if job:
            return await super().run_once()  # uses _handle above
        # No queued job — check cadence and run if due.
        try:
            await self._cycle(force=False)
        except Exception:
            log.exception("curator cycle failed")

    async def _cycle(self, *, force: bool) -> None:
        s = get_settings().discover
        if not force and not _is_due(s.cadence_hours):
            return

        with connect() as conn:
            run_id = q.record_curator_run_start(conn)

        surfaced_count = 0
        err_msg: str | None = None
        try:
            # 1. fan out
            log.info("curator: starting cycle (force=%s)", force)
            results = await asyncio.gather(
                co_citation.candidates(),
                substack_recs.candidates(),
                hn_leaderboard.candidates(),
                arxiv_graph.candidates(),
                return_exceptions=True,
            )
            all_candidates: list[Candidate] = []
            for source_name, result in zip(
                ["co_citation", "substack_recs", "hn_leaderboard", "arxiv_graph"], results
            ):
                if isinstance(result, Exception):
                    log.warning("curator: %s failed: %s", source_name, result)
                    continue
                all_candidates.extend(result)
            log.info("curator: %d raw candidates", len(all_candidates))

            # 2. merge by URL
            merged = _merge_candidates(all_candidates)
            log.info("curator: %d after dedup", len(merged))

            # 3. filter
            filtered = _filter_candidates(merged, min_confluence=s.min_confluence)
            log.info("curator: %d after filtering", len(filtered))

            # 4. top 50 by confluence
            finalists = sorted(filtered, key=lambda c: -c.confluence)[:50]

            # 5. optional Claude judge
            if s.llm_judge_enabled and finalists:
                scores = await llm_judge.score_batch(finalists)
                kept = []
                for c in finalists:
                    score = scores.get(c.url, 0)
                    if score >= llm_judge.MIN_SCORE:
                        # Stash score on the candidate (we'll pass to insert)
                        c.title = c.title  # no-op; just for clarity
                        kept.append((c, score))
                log.info("curator: %d/%d passed Claude judge", len(kept), len(finalists))
            else:
                kept = [(c, None) for c in finalists]

            # 6. cap
            kept = kept[: s.max_per_cycle]

            # 7. insert
            with connect() as conn:
                for cand, score in kept:
                    inserted_id = q.insert_discovery(
                        conn,
                        url=cand.url,
                        domain=cand.domain,
                        title=cand.title,
                        kind=cand.kind,
                        source_kind=cand.source_kind,
                        confluence=cand.confluence,
                        trust_paths=[
                            {
                                "via_subscription_url": p.via_subscription_url,
                                "via_article_id": p.via_article_id,
                                "snippet": p.snippet,
                            }
                            for p in cand.trust_paths
                        ],
                        llm_score=score,
                    )
                    if inserted_id:
                        surfaced_count += 1

            self.emit_feed(
                verb="surfaced",
                obj=f"{surfaced_count} discoveries",
                kind="discovery",
                payload={"checked": len(all_candidates), "after_dedup": len(merged)},
            )
        except Exception as e:
            err_msg = str(e)[:500]
            log.exception("curator: cycle failed")
            self.emit_feed(verb="failed", obj="curator cycle", kind="discovery",
                           payload={"error": err_msg})
            raise
        finally:
            with connect() as conn:
                q.record_curator_run_finish(conn, run_id, surfaced=surfaced_count, error=err_msg)


# ───── helpers ─────

def _is_due(cadence_hours: int) -> bool:
    """True if no successful curator run within `cadence_hours`."""
    with connect() as conn:
        last = q.last_curator_run_at(conn)
    if not last:
        return True  # never run before
    try:
        last_dt = datetime.fromisoformat(last.replace(" ", "T")).replace(tzinfo=timezone.utc)
    except Exception:
        return True
    age_hours = (datetime.now(tz=timezone.utc) - last_dt).total_seconds() / 3600
    return age_hours >= max(1, int(cadence_hours))


def _merge_candidates(candidates: list[Candidate]) -> list[Candidate]:
    """Group by canonical URL; sum confluence; concat trust paths."""
    by_url: dict[str, Candidate] = {}
    for c in candidates:
        if c.url in by_url:
            existing = by_url[c.url]
            existing.confluence += c.confluence
            existing.trust_paths.extend(c.trust_paths)
            # Prefer first kind that's not co_citation (specific signals win)
            if existing.kind == "co_citation" and c.kind != "co_citation":
                existing.kind = c.kind
                existing.source_kind = c.source_kind
        else:
            by_url[c.url] = c
    return list(by_url.values())


_DISLIKES_CACHE: list[str] | None = None


def _load_dislikes() -> list[str]:
    """Lowercased substrings from vault/_self/dislikes.md."""
    global _DISLIKES_CACHE
    if _DISLIKES_CACHE is not None:
        return _DISLIKES_CACHE
    p = self_dir() / "dislikes.md"
    if not p.exists():
        _DISLIKES_CACHE = []
        return _DISLIKES_CACHE
    lines = []
    for line in p.read_text().splitlines():
        cleaned = re.sub(r"^[-*•\d.\s]+", "", line).strip().lower()
        if cleaned and not cleaned.startswith("#"):
            lines.append(cleaned)
    _DISLIKES_CACHE = lines
    return _DISLIKES_CACHE


def _filter_candidates(candidates: list[Candidate], *, min_confluence: int) -> list[Candidate]:
    """Apply confluence threshold + already-subscribed + blocklist + dislikes."""
    if min_confluence < 1:
        min_confluence = 1
    with connect() as conn:
        subscribed_urls = {
            r["url"] for r in conn.execute("SELECT url FROM subscriptions WHERE enabled = 1")
        }
        subscribed_domains = {normalize_domain(u) for u in subscribed_urls}
        blocked_domains = {r["domain"] for r in q.list_blocklist(conn)}
        # Already-open discovery URLs (don't re-surface)
        open_urls = {
            r["url"] for r in conn.execute("SELECT url FROM discoveries WHERE status = 'open'")
        }
    dislikes = _load_dislikes()

    out: list[Candidate] = []
    for c in candidates:
        if c.confluence < min_confluence:
            continue
        if c.url in subscribed_urls:
            continue
        if c.domain in subscribed_domains:
            continue
        if c.domain in blocked_domains:
            continue
        if c.url in open_urls:
            continue
        # Dislikes match against title + URL + trust-path snippets
        haystack = " ".join(filter(None, [
            c.title or "",
            c.url,
            *(p.snippet for p in c.trust_paths),
        ])).lower()
        if any(d in haystack for d in dislikes):
            continue
        out.append(c)
    return out

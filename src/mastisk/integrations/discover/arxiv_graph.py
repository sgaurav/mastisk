"""arXiv citation graph — for each arXiv paper in the user's wiki sources,
fetch its references via the Semantic Scholar API and aggregate. Papers
cited by ≥2 of the user's wiki articles surface as candidates.

Free Semantic Scholar API; rate-limited but generous. Throttled to avoid
bursts. Capped at PER_CYCLE seed papers per cycle.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import defaultdict

import httpx

from mastisk.db.queries import connect

from . import Candidate, TrustPath

log = logging.getLogger("mastisk.discover.arxiv_graph")

USER_AGENT = "Mastisk/0.1 (personal knowledge wiki; discovery)"
HTTP_TIMEOUT = httpx.Timeout(connect=8.0, read=20.0, write=10.0, pool=5.0)
SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1/paper"

# arXiv URL → arXiv ID
_ARXIV_RE = re.compile(r"arxiv\.org/abs/(\d{4}\.\d{4,6})")
PER_CYCLE = 10           # max seed papers per Curator cycle
MIN_INTERVAL = 4.0       # Semantic Scholar rate limit ~100 req/5min unauthenticated; 4s spacing is comfortable

_throttle_lock: asyncio.Lock | None = None
_last_call: float = 0.0


def _get_lock() -> asyncio.Lock:
    global _throttle_lock
    if _throttle_lock is None:
        _throttle_lock = asyncio.Lock()
    return _throttle_lock


async def _throttle() -> None:
    global _last_call
    async with _get_lock():
        elapsed = time.monotonic() - _last_call
        wait = MIN_INTERVAL - elapsed
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call = time.monotonic()


async def candidates() -> list[Candidate]:
    """For each arXiv source in the user's wiki, fetch its references and
    aggregate. Returns Candidates for referenced papers cited by ≥1 of the
    user's articles (orchestrator threshold filters further)."""
    with connect() as conn:
        # Find sources in the wiki that are arXiv papers, joined to their
        # owning articles for trust-path provenance.
        rows = conn.execute(
            """SELECT s.url AS source_url,
                      a.id AS article_id, a.title AS article_title
                 FROM sources s
                 JOIN article_sources ars ON ars.source_id = s.id
                 JOIN articles a ON a.id = ars.article_id
                WHERE s.url LIKE '%arxiv.org/abs/%'"""
        ).fetchall()

    if not rows:
        log.info("arxiv_graph: no arXiv sources in wiki, skipping")
        return []

    # arxiv_id -> [(seed_paper_url, article_id, article_title)]
    seeds: dict[str, list[tuple[str, str, str]]] = defaultdict(list)
    for r in rows:
        m = _ARXIV_RE.search(r["source_url"] or "")
        if not m:
            continue
        seeds[m.group(1)].append(
            (r["source_url"], r["article_id"], r["article_title"] or "untitled"),
        )

    if not seeds:
        return []

    # Cap how many seed papers we walk per cycle.
    seed_ids = list(seeds.keys())[:PER_CYCLE]
    log.info("arxiv_graph: walking %d arXiv seed papers", len(seed_ids))

    # ref_arxiv_id -> [(seed_arxiv_id, paper_title, article_id, article_title)]
    ref_endorsements: dict[str, list[tuple[str, str | None, str, str]]] = defaultdict(list)
    ref_titles: dict[str, str] = {}

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
        for seed_id in seed_ids:
            await _throttle()
            url = f"{SEMANTIC_SCHOLAR_BASE}/arXiv:{seed_id}/references"
            try:
                resp = await client.get(
                    url,
                    params={"fields": "title,externalIds", "limit": 100},
                    headers={"User-Agent": USER_AGENT},
                )
            except Exception as e:
                log.info("arxiv_graph: %s fetch failed: %s", seed_id, e)
                continue
            if resp.status_code >= 400:
                log.info("arxiv_graph: %s returned %s", seed_id, resp.status_code)
                continue
            data = resp.json() or {}
            seed_endorsers = seeds[seed_id]  # the user's articles that cite this seed
            for ref in data.get("data") or []:
                cited = ref.get("citedPaper") or {}
                ext = cited.get("externalIds") or {}
                ref_arxiv = ext.get("ArXiv")
                if not ref_arxiv:
                    continue
                ref_titles[ref_arxiv] = cited.get("title") or ref_titles.get(ref_arxiv)
                # Each article that cites the seed paper effectively endorses
                # the seed's references one hop out.
                for _seed_url, article_id, article_title in seed_endorsers:
                    ref_endorsements[ref_arxiv].append(
                        (seed_id, cited.get("title"), article_id, article_title)
                    )

    out: list[Candidate] = []
    for ref_arxiv, endorsers in ref_endorsements.items():
        # Distinct articles in the user's wiki that endorsed (transitively) this reference
        distinct_articles = {a for _, _, a, _ in endorsers}
        confluence = len(distinct_articles)
        if confluence < 1:
            continue
        # Trust paths: up to 3 distinct article references
        seen = set()
        paths: list[TrustPath] = []
        for _seed_id, _ref_title, article_id, article_title in endorsers:
            if article_id in seen:
                continue
            seen.add(article_id)
            paths.append(TrustPath(
                via_subscription_url=None,
                via_article_id=article_id,
                snippet=f"referenced from “{article_title}”",
            ))
            if len(paths) >= 3:
                break
        out.append(Candidate(
            url=f"https://arxiv.org/abs/{ref_arxiv}",
            domain="arxiv.org",
            title=ref_titles.get(ref_arxiv),
            kind="arxiv_paper",
            source_kind="paper",
            trust_paths=paths,
            confluence=confluence,
        ))

    log.info("arxiv_graph: %d candidate references", len(out))
    return out

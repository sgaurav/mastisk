"""HN domain leaderboard — aggregates how often each external domain has
shown up via HN ingestion (hnrss.org subscriptions feeding sources rows
through Scout/web.ingest_url). Domains with ≥3 hits over the last 30 days
that the user doesn't already follow are candidates.

Pure DB query; no network. Relies on the `subscription_url` thread we wired
through Listener/Scout payloads — sources discovered via HN feeds carry
their HN feed URL in `jobs.payload_json` for the originating compile job.
"""
from __future__ import annotations

import logging
from collections import defaultdict

from mastisk.db.queries import connect

from . import Candidate, TrustPath, normalize_domain

log = logging.getLogger("mastisk.discover.hn_leaderboard")

# Min distinct HN front-page hits per domain before we surface it
MIN_HITS = 3
# Rolling window
WINDOW_DAYS = 30


async def candidates() -> list[Candidate]:
    with connect() as conn:
        # Find all subscription URLs that look like HN feeds (hnrss.org
        # mostly; we also catch raw news.ycombinator.com just in case).
        hn_sub_rows = conn.execute(
            """SELECT url, title FROM subscriptions
                WHERE url LIKE '%hnrss.org%'
                   OR url LIKE '%news.ycombinator.com%'"""
        ).fetchall()
        if not hn_sub_rows:
            log.info("hn_leaderboard: no HN subscriptions, nothing to do")
            return []
        hn_sub_urls = {r["url"] for r in hn_sub_rows}
        hn_sub_title = (hn_sub_rows[0]["title"] or "Hacker News")

        already_subscribed = {
            normalize_domain(r["url"])
            for r in conn.execute("SELECT url FROM subscriptions WHERE enabled = 1")
        }

        # For each compile job whose payload references one of the HN sub
        # URLs and whose source_id resolves to a sources row in the last
        # 30 days, count distinct (source_url) per domain.
        # We do this in Python because the payload_json LIKE matches work
        # better there with our subscription_url thread.
        rows = conn.execute(
            """SELECT j.payload_json, s.url AS source_url, s.title AS source_title
                 FROM jobs j
                 LEFT JOIN sources s ON s.id =
                   json_extract(j.payload_json, '$.source_id')
                WHERE j.agent = 'compiler'
                  AND j.kind = 'compile'
                  AND j.created_at >= datetime('now', '-30 days')
                  AND s.id IS NOT NULL"""
        ).fetchall()

    domain_hits: dict[str, set[str]] = defaultdict(set)
    domain_titles: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        payload = r["payload_json"] or ""
        # Match: this compile job is downstream of an HN subscription
        if not any(hn_url in payload for hn_url in hn_sub_urls):
            continue
        url = r["source_url"]
        if not url:
            continue
        domain = normalize_domain(url)
        if not domain or domain in already_subscribed:
            continue
        domain_hits[domain].add(url)
        if r["source_title"]:
            domain_titles[domain].append(r["source_title"])

    out: list[Candidate] = []
    for domain, urls in domain_hits.items():
        if len(urls) < MIN_HITS:
            continue
        # Pick a representative URL (the most recent — already in arbitrary
        # order from the SQL). Use first.
        rep_url = next(iter(urls))
        # Title hint: the most recent article from that domain
        title = domain_titles[domain][0] if domain_titles[domain] else None
        sample = list(domain_titles[domain])[:2]
        snippet = f"hit HN {len(urls)}× in last {WINDOW_DAYS}d"
        if sample:
            snippet += f" (e.g., “{sample[0]}”)"
        out.append(Candidate(
            url=rep_url,  # representative URL; user can subscribe to the domain's RSS via resolver
            domain=domain,
            title=title,
            kind="hn_domain",
            source_kind="domain",
            trust_paths=[TrustPath(
                via_subscription_url=next(iter(hn_sub_urls)),
                via_article_id=None,
                snippet=snippet,
            )],
            confluence=len(urls),
        ))

    log.info("hn_leaderboard: %d candidate domains", len(out))
    return out

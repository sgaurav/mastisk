"""Substack recommendations — pulls each Substack subscription's
`/recommendations` page and emits the recommended publications as
Candidates. Recommended-by-≥2-of-your-subs is a strong endorsement
signal: writers themselves vouch for each other.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from urllib.parse import urlparse

import httpx

from mastisk.db.queries import connect

from . import Candidate, TrustPath, normalize_domain

log = logging.getLogger("mastisk.discover.substack_recs")

USER_AGENT = "Mastisk/0.1 (personal knowledge wiki; discovery)"
HTTP_TIMEOUT = httpx.Timeout(connect=8.0, read=15.0, write=10.0, pool=5.0)
SUBSTACK_HOST_RE = re.compile(r"^([\w-]+)\.substack\.com$", re.IGNORECASE)
# Substack /recommendations page is HTML; recommendations link out to other
# Substack publications. We pull <a href="https://X.substack.com"> links,
# scoped to the /recommendations area of the page (best-effort regex).
_REC_LINK_RE = re.compile(
    r'href="(https?://[\w-]+\.substack\.com)/?"',
    re.IGNORECASE,
)


async def candidates() -> list[Candidate]:
    """For each Substack subscription, fetch its /recommendations and emit
    Candidates for recommended publications. Confluence = how many of the
    user's Substack subs recommend the same publication."""
    with connect() as conn:
        subs = [
            dict(r) for r in conn.execute(
                "SELECT url, title FROM subscriptions WHERE enabled = 1"
            )
        ]

    substack_subs = []
    subscribed_substack_homes = set()
    for s in subs:
        host = (urlparse(s["url"]).hostname or "").lower()
        if SUBSTACK_HOST_RE.match(host):
            substack_subs.append(s)
            subscribed_substack_homes.add(f"https://{host}")

    if not substack_subs:
        log.info("substack_recs: no Substack subscriptions, nothing to fetch")
        return []

    # rec_home -> [(via_sub_url, via_sub_title)]
    seen: dict[str, list[tuple[str, str]]] = defaultdict(list)

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
        for sub in substack_subs:
            host = (urlparse(sub["url"]).hostname or "").lower()
            recs_url = f"https://{host}/recommendations"
            try:
                resp = await client.get(recs_url, headers={"User-Agent": USER_AGENT})
            except Exception as e:
                log.info("substack_recs: %s fetch failed: %s", host, e)
                continue
            if resp.status_code >= 400:
                log.info("substack_recs: %s returned %s", host, resp.status_code)
                continue
            html = resp.text
            for m in _REC_LINK_RE.finditer(html):
                rec_home = m.group(1).lower().rstrip("/")
                # Skip self-recommendations and already-subscribed Substacks
                if rec_home == f"https://{host}":
                    continue
                if rec_home in subscribed_substack_homes:
                    continue
                seen[rec_home].append(
                    (sub["url"], sub["title"] or host),
                )

    out: list[Candidate] = []
    for rec_home, sources_list in seen.items():
        # Distinct subscriptions recommending this publication
        distinct_subs = {s_url for s_url, _ in sources_list}
        confluence = len(distinct_subs)
        # The candidate URL is the Substack feed (publication's RSS).
        feed_url = f"{rec_home}/feed"
        # Trust paths: up to 3 distinct subscription endorsements
        seen_subs = set()
        paths: list[TrustPath] = []
        for s_url, s_title in sources_list:
            if s_url in seen_subs:
                continue
            seen_subs.add(s_url)
            paths.append(TrustPath(
                via_subscription_url=s_url,
                via_article_id=None,
                snippet=f"recommended by {s_title}",
            ))
            if len(paths) >= 3:
                break
        out.append(Candidate(
            url=feed_url,
            domain=normalize_domain(rec_home),
            title=None,
            kind="substack_rec",
            source_kind="feed",
            trust_paths=paths,
            confluence=confluence,
        ))

    log.info("substack_recs: %d candidates from %d Substack subs", len(out), len(substack_subs))
    return out

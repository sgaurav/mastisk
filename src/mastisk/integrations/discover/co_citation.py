"""Co-citation walker — finds external URLs cited by ≥N of the user's
articles. Pure DB query; no network calls.

Walks `article_sections.body` for markdown links + bare URLs, groups by
canonical URL, and emits one Candidate per URL with confluence = the count
of distinct articles citing it.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from urllib.parse import urlparse

from mastisk.db.queries import connect

from . import Candidate, TrustPath, normalize_domain

log = logging.getLogger("mastisk.discover.co_citation")

# Markdown link [text](url)  — captures URL in group 2
_MD_LINK_RE = re.compile(r"\[([^\]]{1,200})\]\((https?://[^\s)]+)\)")
# Bare URL fallback for body text that just drops a link inline
_BARE_URL_RE = re.compile(r"(?<!\()(?<!\])(https?://[^\s<>\"'\)]+)")

# Domains we never surface as discoveries (self / infra / aggregators that
# aren't useful as a "follow this site" recommendation).
_DROP_DOMAINS = {
    "localhost",
    "127.0.0.1",
    "github.io",  # too broad on its own; per-author github.io subdomains do pass through
    "google.com",
    "youtube.com",  # already a Subscriptions kind
    "youtu.be",
    "twitter.com",  # out per design call
    "x.com",
    "facebook.com",
    "linkedin.com",
    "amazon.com",
    "wikipedia.org",  # canonical reference site, not a "follow" candidate
    "en.wikipedia.org",
    "news.ycombinator.com",  # the user follows HN via hnrss
}


async def candidates() -> list[Candidate]:
    """Return list of Candidate objects from co-citation analysis. Each URL
    cited by ≥1 article emits one Candidate with confluence = distinct
    article count (the orchestrator's threshold filter trims further)."""
    # url -> [(article_id, article_title)]
    cited: dict[str, list[tuple[str, str]]] = defaultdict(list)

    with connect() as conn:
        # Pull all article body text + their titles + the URLs of their own
        # sources (so we can exclude self-references).
        rows = conn.execute(
            """SELECT a.id AS article_id, a.title AS article_title,
                      s.body AS body
                 FROM articles a
                 JOIN article_sections s ON s.article_id = a.id
                 WHERE s.kind != 'open' AND s.body IS NOT NULL"""
        ).fetchall()
        # Build the set of source URLs already attached to each article so
        # we don't re-surface the article's own primary sources as
        # discoveries.
        own_sources: dict[str, set[str]] = defaultdict(set)
        for r in conn.execute(
            """SELECT article_sources.article_id, sources.url
                 FROM article_sources
                 JOIN sources ON sources.id = article_sources.source_id
                WHERE sources.url IS NOT NULL"""
        ):
            own_sources[r["article_id"]].add(r["url"])

        # Domains the user already subscribes to — never re-surface those.
        already_subscribed_domains = {
            normalize_domain(r["url"])
            for r in conn.execute("SELECT url FROM subscriptions WHERE enabled = 1")
        }

    # Aggregate per-article: for each article, take the *set* of distinct
    # URLs cited (so a single article with 5 mentions of one URL counts
    # once toward confluence).
    for row in rows:
        body = row["body"] or ""
        article_id = row["article_id"]
        article_title = (row["article_title"] or "untitled").strip()

        article_urls: set[str] = set()
        for m in _MD_LINK_RE.finditer(body):
            article_urls.add(m.group(2))
        for m in _BARE_URL_RE.finditer(body):
            article_urls.add(m.group(1))

        # Filter in-flight
        for url in article_urls:
            if url in own_sources[article_id]:
                continue
            domain = normalize_domain(url)
            if not domain:
                continue
            if domain in _DROP_DOMAINS:
                continue
            if domain in already_subscribed_domains:
                continue
            cited[_canonicalize(url)].append((article_id, article_title))

    # Build Candidates
    out: list[Candidate] = []
    for url, refs in cited.items():
        # Distinct article count
        distinct_articles = {a for a, _ in refs}
        if not distinct_articles:
            continue
        confluence = len(distinct_articles)
        # Trust paths — keep up to the first 3 distinct article references
        seen = set()
        paths: list[TrustPath] = []
        for article_id, article_title in refs:
            if article_id in seen:
                continue
            seen.add(article_id)
            paths.append(TrustPath(
                via_subscription_url=None,
                via_article_id=article_id,
                snippet=f"cited by “{article_title}”",
            ))
            if len(paths) >= 3:
                break
        out.append(Candidate(
            url=url,
            domain=normalize_domain(url),
            title=None,  # title is fetched on accept (via the resolver) or save (via web.ingest_url)
            kind="co_citation",
            source_kind="domain",  # accept = subscribe to the domain's likely-RSS feed
            trust_paths=paths,
            confluence=confluence,
        ))

    log.info("co_citation: %d candidates from %d articles", len(out), len(rows))
    return out


def _canonicalize(url: str) -> str:
    """Strip URL fragment and common tracking query params for dedup."""
    try:
        p = urlparse(url)
        if not p.scheme or not p.hostname:
            return url
        # Drop fragment; keep path/query (but the params dance below)
        # Strip common tracking params (utm_*, ref, fbclid, gclid)
        query_pairs = []
        for kv in (p.query or "").split("&"):
            if not kv:
                continue
            k = kv.split("=", 1)[0].lower()
            if k.startswith("utm_") or k in ("ref", "fbclid", "gclid", "mc_cid", "mc_eid"):
                continue
            query_pairs.append(kv)
        query = "&".join(query_pairs)
        host = p.hostname.lower().removeprefix("www.")
        path = p.path.rstrip("/") or "/"
        rebuilt = f"{p.scheme}://{host}{path}"
        if query:
            rebuilt += f"?{query}"
        return rebuilt
    except Exception:
        return url

"""Discovery — surface high-quality sources outside the user's subscriptions.

The Curator agent runs the four signal modules in parallel, merges
candidates by URL, applies confluence/blocklist/dislikes filters, optionally
runs a Claude relevance pass, and writes survivors to the `discoveries`
table.

Trust-transfer principle: every Candidate carries one or more TrustPaths
explaining *why* it surfaced — which subscription endorsed it, which
article cited it, etc. The UI surfaces these so the user can see the
provenance, not just the recommendation.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import urlparse

DiscoveryKind = Literal["co_citation", "substack_rec", "hn_domain", "arxiv_paper"]
SourceKind = Literal["feed", "article", "paper", "domain"]


@dataclass
class TrustPath:
    """Why this candidate surfaced — a concrete endorsement chain."""
    via_subscription_url: str | None
    via_article_id: str | None
    snippet: str  # one-line, e.g., "cited by Lilian Weng — Why agents work"


@dataclass
class Candidate:
    url: str
    domain: str
    title: str | None
    kind: DiscoveryKind
    source_kind: SourceKind
    trust_paths: list[TrustPath] = field(default_factory=list)
    confluence: int = 1


def normalize_domain(url: str) -> str:
    """Strip www., lowercase, no trailing slash. Empty for malformed URLs."""
    try:
        host = (urlparse(url).hostname or "").lower()
    except Exception:
        return ""
    return host.removeprefix("www.")

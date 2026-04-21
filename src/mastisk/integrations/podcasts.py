"""Classify incoming URLs + resolve RSS episodes to direct audio."""
from __future__ import annotations

import logging
from datetime import datetime
from urllib.parse import urljoin, urlparse

import feedparser
import httpx

log = logging.getLogger("mastisk.podcasts")

_AUDIO_EXTS = (".mp3", ".m4a", ".ogg", ".opus", ".wav", ".aac", ".flac")


class UnsupportedPlatformError(Exception):
    """Raised for platforms whose audio we can't download (Spotify etc)."""


async def classify(url: str) -> str:
    """Return 'youtube' | 'rss' | 'direct_audio' | 'spotify' | 'unknown'."""
    if not url:
        return "unknown"
    u = url.strip()
    parsed = urlparse(u)
    host = (parsed.hostname or "").lower()
    path_lower = (parsed.path or "").lower()

    if host.endswith("youtube.com") or host == "youtu.be" or host.endswith("youtube-nocookie.com"):
        return "youtube"
    if host.endswith("spotify.com"):
        return "spotify"
    if any(path_lower.endswith(ext) for ext in _AUDIO_EXTS):
        return "direct_audio"

    # Network sniff for RSS. One HEAD request — cheap.
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8.0) as c:
            resp = await c.head(u)
        ctype = (resp.headers.get("content-type") or "").lower()
    except Exception as e:
        log.info("podcasts.classify: HEAD failed for %s: %s", u, e)
        return "unknown"
    if "application/rss+xml" in ctype or "application/atom+xml" in ctype:
        return "rss"
    if "text/xml" in ctype or "application/xml" in ctype:
        return await _sniff_xml_for_rss(u)
    # Some feeds return text/html from HEAD; do a small GET sniff as a last chance.
    if "text/html" not in ctype and "application/json" not in ctype:
        return await _sniff_xml_for_rss(u)
    return "unknown"


async def _sniff_xml_for_rss(url: str) -> str:
    """GET the first ~4KB and look for <rss or <feed roots."""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=8.0) as c:
            resp = await c.get(url, headers={"Range": "bytes=0-4095"})
    except Exception:
        return "unknown"
    head = (resp.text or "")[:4096].lower()
    if "<rss" in head or "<feed" in head:
        return "rss"
    return "unknown"


async def resolve_rss_episode(feed_url: str, max_episodes: int = 1) -> list[dict]:
    """Parse a podcast RSS feed, return the latest N episodes with audio URLs.

    Each dict: {title, audio_url, published_at, author, description, duration}.
    """
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as c:
            resp = await c.get(feed_url, headers={"User-Agent": "Mastisk/0.1"})
    except Exception as e:
        raise RuntimeError(f"rss fetch failed: {e}") from e
    if resp.status_code >= 400:
        raise RuntimeError(f"rss fetch returned {resp.status_code}")

    parsed = feedparser.parse(resp.content)
    if parsed.bozo and not parsed.entries:
        raise RuntimeError(f"malformed rss feed: {parsed.bozo_exception}")

    out: list[dict] = []
    for entry in parsed.entries[: max(1, max_episodes)]:
        audio_url = _pick_audio_enclosure(entry)
        if not audio_url:
            continue
        # Resolve relative hrefs (some feeds emit `/episodes/ep1.mp3`) against
        # the feed URL so downstream httpx calls don't choke on UnsupportedProtocol.
        audio_url = urljoin(feed_url, audio_url)
        pub = entry.get("published_parsed") or entry.get("updated_parsed")
        pub_iso = datetime(*pub[:6]).isoformat(sep=" ") if pub else None
        out.append({
            "title": entry.get("title") or "",
            "audio_url": audio_url,
            "published_at": pub_iso,
            "author": entry.get("author") or parsed.feed.get("author") or "",
            "description": entry.get("summary") or entry.get("description") or "",
            "duration": entry.get("itunes_duration") or "",
        })
    return out


def _pick_audio_enclosure(entry: dict) -> str | None:
    """Return the first audio enclosure URL in an RSS entry."""
    for enc in entry.get("enclosures") or []:
        t = (enc.get("type") or "").lower()
        href = enc.get("href") or enc.get("url")
        if href and t.startswith("audio"):
            return href
    # Fallback — some feeds skip the type attr. Strip query string before ext
    # check so `https://cdn.example/ep1.mp3?token=abc` still resolves.
    for enc in entry.get("enclosures") or []:
        href = enc.get("href") or enc.get("url")
        if not href:
            continue
        path = urlparse(href).path.lower()
        if any(path.endswith(ext) for ext in _AUDIO_EXTS):
            return href
    return None

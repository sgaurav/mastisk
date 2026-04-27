"""URL resolver for the Subscriptions feature.

Takes any URL the user pastes (YouTube channel/playlist/handle, podcast feed,
Apple Podcasts link, blog RSS) and returns one of three canonical kinds plus
the RSS feed URL we will poll. Apple Podcasts and YouTube `@handle`/playlist
normalization happen here so the rest of the system only sees three kinds.
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qs, urlparse

import feedparser
import httpx

from mastisk.integrations import youtube as yt_int

USER_AGENT = "Mastisk/0.1 (+local)"
HTTP_TIMEOUT = 15.0


@dataclass
class Resolved:
    kind: Literal["rss", "youtube", "podcast"]
    url: str           # canonical RSS URL we poll
    source_url: str    # what the user pasted
    title: str
    item_count: int | None = None


class ResolveError(Exception):
    """User-facing resolver error. Message is shown verbatim in the UI."""


YT_HOSTS = ("youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com")
APPLE_HOST = "podcasts.apple.com"

# Apple Podcasts URLs end with `/idNNNNN[?...]`
APPLE_ID_RE = re.compile(r"/id(\d+)(?:\?|$|/)")
ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup"


async def resolve(user_url: str) -> Resolved:
    user_url = (user_url or "").strip()
    if not user_url:
        raise ResolveError("URL is required")
    parsed = urlparse(user_url)
    host = (parsed.hostname or "").lower()

    if "spotify.com" in host:
        raise ResolveError(
            "Spotify podcasts are DRM-protected and can't be ingested. "
            "Try the show's RSS feed URL instead — most podcasts publish one."
        )

    if host in YT_HOSTS:
        return await _resolve_youtube(user_url, parsed)

    if host == APPLE_HOST:
        return await _resolve_apple_podcasts(user_url)

    # Otherwise treat as an RSS feed URL — could be blog or podcast.
    return await _resolve_rss(user_url, source_url=user_url)


# ─── YouTube ──────────────────────────────────────────────────────────────

async def _resolve_youtube(url: str, parsed) -> Resolved:
    """Convert any YouTube URL form (channel, @handle, /c/, /user/, playlist)
    into the RSS feed URL we poll, plus the channel/playlist title."""
    qs = parse_qs(parsed.query)
    if "list" in qs:
        playlist_id = qs["list"][0]
        # We use yt-dlp metadata to get the playlist title + length.
        meta = await _yt_metadata(url)
        title = meta.get("title") or playlist_id
        count = meta.get("playlist_count")
        return Resolved(
            kind="youtube",
            url=f"https://www.youtube.com/feeds/videos.xml?playlist_id={playlist_id}",
            source_url=url,
            title=str(title),
            item_count=count or None,
        )

    # Channel URL — could be /channel/UC..., /@handle, /c/Name, /user/Name.
    # yt-dlp resolves all of these to the same metadata with a `channel_id`.
    meta = await _yt_metadata(url)
    channel_id = meta.get("channel_id") or meta.get("uploader_id")
    if not channel_id or not channel_id.startswith("UC"):
        raise ResolveError(
            "Couldn't resolve this YouTube URL to a channel. Try the channel's main page "
            "(youtube.com/@handle or youtube.com/channel/UC...)."
        )
    title = meta.get("channel") or meta.get("uploader") or meta.get("title") or channel_id
    # playlist_count is the video count; channel_follower_count is subscribers
    # (misleading for "items" — never expose it as item_count).
    count = meta.get("playlist_count")
    return Resolved(
        kind="youtube",
        url=f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}",
        source_url=url,
        title=str(title),
        item_count=count or None,
    )


async def _yt_metadata(url: str) -> dict:
    """Light yt-dlp probe for channel/playlist URLs.

    The Listener's :func:`yt_int._extract_info` walks every video in a channel,
    which can take minutes for popular creators. We only need the channel/
    playlist-level fields (channel_id, title, count) — extract_flat='in_playlist'
    skips per-video metadata and returns in seconds.
    """
    def _run() -> dict:
        from yt_dlp import YoutubeDL
        opts = {
            "quiet": True, "no_warnings": True, "skip_download": True,
            "extract_flat": "in_playlist",
            "playlist_items": "1",  # we don't need entries — metadata only
        }
        with YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False) or {}

    try:
        return await asyncio.to_thread(_run)
    except Exception as e:  # yt-dlp raises a wide range of exceptions
        raise ResolveError(f"YouTube metadata fetch failed: {e}") from e


# ─── Apple Podcasts → RSS ─────────────────────────────────────────────────

async def _resolve_apple_podcasts(user_url: str) -> Resolved:
    """Apple Podcasts URLs are pointers — the audio lives at an underlying RSS
    feed. The free iTunes Lookup API resolves the show ID to its feedUrl."""
    m = APPLE_ID_RE.search(user_url)
    if not m:
        raise ResolveError(
            "Couldn't find a podcast ID in this Apple Podcasts URL. "
            "Open the show in Apple Podcasts, then copy the URL again."
        )
    show_id = m.group(1)
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as c:
            resp = await c.get(
                ITUNES_LOOKUP_URL,
                params={"id": show_id, "entity": "podcast"},
                headers={"User-Agent": USER_AGENT},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        raise ResolveError(f"iTunes lookup failed: {e}") from e
    results = data.get("results") or []
    if not results:
        raise ResolveError("iTunes returned no results for this Apple Podcasts URL.")
    feed_url = results[0].get("feedUrl")
    if not feed_url:
        raise ResolveError(
            "Apple Podcasts didn't expose an RSS feed for this show. "
            "Some shows are Apple-exclusive and can't be ingested."
        )
    # Recurse through the RSS path so we get a consistent title + count.
    inner = await _resolve_rss(feed_url, source_url=user_url)
    # Force kind=podcast — iTunes lookup confirmed this is a podcast.
    return Resolved(
        kind="podcast",
        url=inner.url,
        source_url=user_url,
        title=inner.title or results[0].get("collectionName") or "Podcast",
        item_count=inner.item_count,
    )


# ─── Generic RSS (blog or podcast) ────────────────────────────────────────

async def _resolve_rss(url: str, *, source_url: str) -> Resolved:
    """Fetch + parse a feed. Classify as podcast if the first entry has an
    audio enclosure; otherwise treat as a blog RSS feed."""
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, follow_redirects=True) as c:
            resp = await c.get(url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml"})
            if resp.status_code >= 400:
                raise ResolveError(f"feed returned HTTP {resp.status_code}")
            body = resp.content
    except ResolveError:
        raise
    except Exception as e:
        raise ResolveError(f"couldn't fetch the URL: {e}") from e

    parsed = feedparser.parse(body)
    if parsed.bozo and not parsed.entries:
        raise ResolveError(
            "this URL doesn't look like a valid RSS or Atom feed. "
            "Try the feed/RSS link from the site's footer."
        )
    title = (parsed.feed.get("title") or "").strip()
    count = len(parsed.entries) if parsed.entries else None

    is_podcast = False
    if parsed.entries:
        first = parsed.entries[0]
        enclosures = first.get("enclosures") or []
        if any((e.get("type") or "").startswith("audio/") for e in enclosures):
            is_podcast = True

    return Resolved(
        kind="podcast" if is_podcast else "rss",
        url=url,
        source_url=source_url,
        title=title or url,
        item_count=count,
    )

"""yt-dlp Python API wrapper. No binary-on-PATH dependency.

Three entry points: metadata fetch, subtitle fetch (plain text), and audio
download. All sync under the hood (yt-dlp is sync); callers `await` via
`asyncio.to_thread` so the scheduler tick isn't blocked.

Throttle: a module-level async lock + last-call timestamp ensures we never
hit YouTube faster than ``_MIN_INTERVAL_SECONDS``. Bursts of yt-dlp calls
(e.g. when Listener picks several queued transcribe jobs back-to-back) are
the most common trigger for YouTube's bot-detection rate limit, which
blocks the IP for ~1h. Spacing requests by a few seconds is enough to keep
us under the radar without noticeably hurting end-to-end latency.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from pathlib import Path

log = logging.getLogger("mastisk.youtube")

_MIN_INTERVAL_SECONDS = 8.0
_throttle_lock: asyncio.Lock | None = None
_last_fetch_at: float = 0.0


def _get_lock() -> asyncio.Lock:
    """Lazy-init: asyncio.Lock binds to the running loop, but this module
    can be imported before any loop exists."""
    global _throttle_lock
    if _throttle_lock is None:
        _throttle_lock = asyncio.Lock()
    return _throttle_lock


async def _throttle() -> None:
    """Sleep just long enough so consecutive yt-dlp calls are spaced out."""
    global _last_fetch_at
    async with _get_lock():
        elapsed = time.monotonic() - _last_fetch_at
        wait = _MIN_INTERVAL_SECONDS - elapsed
        if wait > 0:
            log.debug("youtube: throttling for %.1fs", wait)
            await asyncio.sleep(wait)
        _last_fetch_at = time.monotonic()


async def fetch_metadata(url: str) -> dict:
    """Return normalized video metadata. Raises RuntimeError on failure."""
    await _throttle()
    try:
        info = await asyncio.to_thread(_extract_info, url, False)
    except Exception as e:
        raise RuntimeError(f"yt-dlp: {e}") from e
    upload = info.get("upload_date") or ""
    upload_iso = f"{upload[:4]}-{upload[4:6]}-{upload[6:8]}" if len(upload) == 8 else None
    return {
        "id": info.get("id") or "",
        "title": info.get("title") or "",
        "uploader": info.get("uploader") or "",
        "channel": info.get("channel") or "",
        "upload_date": upload_iso,
        "duration_sec": int(info.get("duration") or 0),
        "description": info.get("description") or "",
        "thumbnail": info.get("thumbnail") or "",
        "webpage_url": info.get("webpage_url") or url,
    }


async def fetch_subtitles(url: str, out_dir: Path) -> str | None:
    """Fetch best English subtitle (human > auto) and return path to a .txt
    containing concatenated dedup'd lines. None if no subs available.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    await _throttle()
    try:
        vtt_path = await asyncio.to_thread(_download_subs, url, out_dir)
    except Exception as e:
        raise RuntimeError(f"yt-dlp: {e}") from e
    if not vtt_path or not vtt_path.exists():
        return None
    text = _vtt_to_plaintext(vtt_path.read_text(encoding="utf-8", errors="replace"))
    if not text.strip():
        return None
    txt_path = vtt_path.with_suffix(".txt")
    txt_path.write_text(text, encoding="utf-8")
    return str(txt_path)


async def download_audio(url: str, out_dir: Path) -> Path:
    """Download best audio track, convert to m4a if needed. Returns path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    await _throttle()
    try:
        path = await asyncio.to_thread(_download_audio, url, out_dir)
    except Exception as e:
        raise RuntimeError(f"yt-dlp: {e}") from e
    if not path or not Path(path).exists():
        raise RuntimeError(f"yt-dlp: audio download produced no file for {url}")
    return Path(path)


# ───── sync yt-dlp helpers (run under asyncio.to_thread) ─────


def _extract_info(url: str, download: bool) -> dict:
    from yt_dlp import YoutubeDL
    opts = {"quiet": True, "no_warnings": True, "skip_download": not download}
    with YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=download) or {}


def _download_subs(url: str, out_dir: Path) -> Path | None:
    """Write best available en subtitle as .vtt into out_dir. Return the path
    or None if nothing was written. Prefers human-authored over automatic."""
    from yt_dlp import YoutubeDL
    outtmpl = str(out_dir / "%(id)s.%(ext)s")
    base_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "subtitleslangs": ["en", "en-US", "en-GB"],
        "subtitlesformat": "vtt",
        "outtmpl": outtmpl,
    }
    # First pass: human subs only.
    opts_human = {**base_opts, "writesubtitles": True, "writeautomaticsub": False}
    with YoutubeDL(opts_human) as ydl:
        info = ydl.extract_info(url, download=True) or {}
    vid = info.get("id") or ""
    found = _find_vtt(out_dir, vid)
    if found:
        return found
    # Fallback: automatic captions.
    opts_auto = {**base_opts, "writesubtitles": False, "writeautomaticsub": True}
    with YoutubeDL(opts_auto) as ydl:
        info = ydl.extract_info(url, download=True) or {}
    vid = info.get("id") or vid
    return _find_vtt(out_dir, vid)


def _find_vtt(out_dir: Path, vid: str) -> Path | None:
    """yt-dlp names subs like <id>.en.vtt, <id>.en-US.vtt etc. Prefer exact en."""
    if not vid:
        return None
    for lang in ("en", "en-US", "en-GB"):
        p = out_dir / f"{vid}.{lang}.vtt"
        if p.exists():
            return p
    # Last resort: any .vtt starting with this id
    for p in out_dir.glob(f"{vid}.*.vtt"):
        return p
    return None


def _download_audio(url: str, out_dir: Path) -> str | None:
    from yt_dlp import YoutubeDL
    outtmpl = str(out_dir / "%(id)s.%(ext)s")
    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "m4a"},
        ],
    }
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True) or {}
    vid = info.get("id") or ""
    # After postprocessing the file should be <id>.m4a. Fall back to any file.
    cand = out_dir / f"{vid}.m4a"
    if cand.exists():
        return str(cand)
    for ext in ("m4a", "mp3", "webm", "opus", "ogg", "wav"):
        cand = out_dir / f"{vid}.{ext}"
        if cand.exists():
            return str(cand)
    for p in out_dir.glob(f"{vid}.*"):
        return str(p)
    return None


# ───── vtt parsing ─────

_TS_RE = re.compile(r"^\s*\d{2}:\d{2}[:.]\d{2}[.,]\d{3}\s*-->")
_TAG_RE = re.compile(r"<[^>]+>")


def _vtt_to_plaintext(vtt: str) -> str:
    """Strip WEBVTT header, drop cue timings, collapse consecutive duplicates."""
    out: list[str] = []
    last: str | None = None
    for raw in vtt.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("WEBVTT") or line.startswith("NOTE") or line.startswith("Kind:") \
                or line.startswith("Language:") or line.startswith("STYLE"):
            continue
        if _TS_RE.match(line) or "-->" in line:
            continue
        # Cue identifier lines are pure digits or a hash; skip if followed by a timestamp.
        # Simpler: skip lines with no word characters. Unicode-aware so we keep
        # Japanese/Chinese/Korean/Cyrillic/Arabic/etc. content.
        if not re.search(r"\w", line, re.UNICODE):
            continue
        clean = _TAG_RE.sub("", line).strip()
        if not clean or clean == last:
            continue
        out.append(clean)
        last = clean
    return "\n".join(out)

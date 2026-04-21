"""mlx-whisper wrapper. Lazy import — mlx-whisper is an optional extra."""
from __future__ import annotations

import asyncio
import importlib
import logging
from pathlib import Path

log = logging.getLogger("mastisk.whisper")

_INSTALL_HINT = (
    "Audio transcription needs mlx-whisper. "
    "Install with: uv tool install --force --reinstall --with mlx-whisper mastisk"
)


def is_available() -> bool:
    try:
        importlib.import_module("mlx_whisper")
        return True
    except ImportError:
        return False


async def transcribe(
    audio_path: Path,
    model: str = "mlx-community/whisper-medium",
) -> str:
    """Transcribe an audio file with mlx-whisper. Returns plain text.

    Raises RuntimeError if mlx-whisper isn't installed — the message includes
    an install hint so the failed-job UI is actionable.
    """
    if not is_available():
        raise RuntimeError(_INSTALL_HINT)
    return await asyncio.to_thread(_run_mlx, audio_path, model)


def _run_mlx(audio_path: Path, model: str) -> str:
    import mlx_whisper  # type: ignore[import-untyped]
    result = mlx_whisper.transcribe(str(audio_path), path_or_hf_repo=model)
    # mlx_whisper returns {"text": "...", "segments": [...]}
    if isinstance(result, dict):
        return (result.get("text") or "").strip()
    return str(result).strip()

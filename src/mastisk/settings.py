"""Runtime configuration. Load order:

1. Environment variables (MASTISK_*, OLLAMA_*, CLAUDE_CMD)
2. ~/Library/Application Support/Mastisk/config.toml
3. .env (dev only)
4. Defaults
"""
from __future__ import annotations

import os
import tempfile
import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Any

import tomli_w
from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from mastisk.paths import config_path


class AgentBudget(BaseSettings):
    scout: int = 500
    listener: int = 20
    compiler: int = 100
    linter: int = 50
    synthesizer: int = 10


class NotesSettings(BaseSettings):
    """Config for the notes subsystem. See docs/superpowers/specs/2026-04-21-notes-subsystem-design.md §8."""
    classify_stable_mtime_seconds: int = 30
    auto_escalate_cap: int = 20
    auto_escalate_min_confidence: float = 0.7
    auto_escalate_min_length: int = 80
    auto_escalate_classifications: list[str] = Field(default_factory=lambda: ["idea", "question"])
    dedup_hours: int = 24
    dedup_similarity_threshold: float = 0.85
    claude_retry_count: int = 2
    claude_retry_backoff_mins: list[int] = Field(default_factory=lambda: [30, 60])
    notetaker_model: str = "llama3.1:8b"
    escalator_model: str = "claude-sonnet-4-6"
    notetaker_concurrency: int = 4


class RoundtableSettings(BaseSettings):
    """Config for the multi-LLM roundtable subsystem.
    See docs/superpowers/specs/2026-04-22-multi-llm-roundtable-design.md §7."""
    backends: list[str] = Field(default_factory=lambda: ["claude", "codex", "gemini", "ollama"])
    timeout_seconds: int = 120
    synthesis_model: str = "claude"
    perspective_models: dict[str, str] = Field(default_factory=lambda: {
        "claude": "claude-sonnet-4-6",
        "codex": "gpt-5-codex",
        "gemini": "gemini-2.5-pro",
        "ollama": "llama3.1:8b",
    })
    context_max_chars: int = 4000


class GithubSettings(BaseSettings):
    """Config for the GitHub Context Agent subsystem.
    See docs/superpowers/specs/2026-04-22-github-context-agent-design.md §7."""
    pat: str = ""
    poll_interval_minutes: int = 60
    ideate_tick_minutes: int = 60
    ideate_min_interval_hours: int = 24
    ideas_per_run: int = 4
    ideate_model: str = "claude-sonnet-4-6"


class Settings(BaseSettings):
    # populate_by_name: accept both the field name (from TOML) AND the alias
    # (from env vars). Without this, pydantic v2 silently drops TOML kwargs
    # for any Field with an alias — so e.g. ollama_local_only in config.toml
    # would be ignored and fall back to the default.
    model_config = SettingsConfigDict(
        env_file=".env", extra="ignore", case_sensitive=False, populate_by_name=True,
    )

    # Server
    host: str = Field(default="0.0.0.0", alias="MASTISK_HOST")
    port: int = Field(default=8080, alias="MASTISK_PORT")

    # Claude
    claude_cmd: str = Field(default="claude", alias="CLAUDE_CMD")

    # Ollama
    ollama_cloud_url: str = Field(default="https://ollama.com", alias="OLLAMA_CLOUD_URL")
    ollama_cloud_key: str | None = Field(default=None, alias="OLLAMA_CLOUD_KEY")
    ollama_local_url: str = Field(default="http://localhost:11434", alias="OLLAMA_LOCAL_URL")
    ollama_local_only: bool = Field(default=False, alias="OLLAMA_LOCAL_ONLY")

    # Models. Defaults chosen to work out of the box with common local + cloud-proxied Ollama stacks.
    # Override in ~/Library/Application Support/Mastisk/config.toml
    embed_model: str = "nomic-embed-text"        # `ollama pull nomic-embed-text`
    summarize_model_heavy: str = "kimi-k2.5:cloud"  # cloud-proxied via signed-in local ollama
    summarize_model_cheap: str = "qwen3.5:4b"    # local, fast

    # Agent budgets (daily caps — enforced by Agent.run_once)
    budget: AgentBudget = Field(default_factory=AgentBudget)

    notes: NotesSettings = Field(default_factory=NotesSettings)

    roundtable: RoundtableSettings = Field(default_factory=RoundtableSettings)

    github: GithubSettings = Field(default_factory=GithubSettings)

    # RSS feeds to subscribe (managed via CLI, stored in DB — this is just the initial seed)
    seed_feeds: list[str] = Field(default_factory=list)


def _load_toml_if_present() -> dict:
    p = config_path()
    if not p.exists():
        return {}
    with p.open("rb") as f:
        return tomllib.load(f)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    # Dev-mode: load .env from cwd if present
    load_dotenv()
    toml_data = _load_toml_if_present()
    # Pydantic reads env + defaults. Merge toml on top (toml wins over defaults, env wins over toml).
    return Settings(**toml_data)


def reload_settings() -> Settings:
    get_settings.cache_clear()
    return get_settings()


def update_toml_key(section: str, key: str, value: Any) -> None:
    """Surgically update one key in config.toml. Creates the file if missing.

    Only mutates the single (section, key) pair. Any other keys in the file
    are preserved verbatim. Caller is responsible for calling reload_settings()
    after this returns.
    """
    p = config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    data: dict = {}
    if p.exists():
        with p.open("rb") as f:
            data = tomllib.load(f)
    section_dict = data.setdefault(section, {})
    section_dict[key] = value
    # Atomic write via tempfile + rename
    fd, tmp = tempfile.mkstemp(prefix=f".{p.name}.", suffix=".tmp", dir=p.parent)
    try:
        with os.fdopen(fd, "wb") as f:
            tomli_w.dump(data, f)
        os.replace(tmp, p)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise

"""Runtime configuration. Load order:

1. Environment variables (MASTISK_*, OLLAMA_*, CLAUDE_CMD)
2. ~/Library/Application Support/Mastisk/config.toml
3. .env (dev only)
4. Defaults
"""
from __future__ import annotations

import tomllib
from functools import lru_cache
from pathlib import Path

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

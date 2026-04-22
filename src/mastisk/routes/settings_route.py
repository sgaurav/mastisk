"""Settings API — read/write the TOML config the daemon uses at runtime.

The UI-facing settings page hits these endpoints. Writes merge into the
existing config.toml, then invalidate the lru_cache on ``get_settings`` so the
running process picks up the new values immediately (no restart required for
model/URL/budget changes).
"""
from __future__ import annotations

import json
import tomllib
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mastisk.paths import config_path
from mastisk.settings import get_settings, reload_settings, update_toml_key

router = APIRouter(tags=["settings"])


# What each model is used for — surfaced in the UI so the user knows *why*
# they're configuring each field. Keep tight; the UI copies render verbatim.
MODEL_ROLES = {
    "claude_cmd": (
        "Claude CLI used by the Compiler to write full wiki pages. "
        "Accepts a bare name (resolved via PATH) or an absolute path."
    ),
    "embed_model": (
        "Ollama embedding model. Scout scores each RSS item against your "
        "interests.md with cosine similarity to decide whether to clip it. "
        "Run `ollama pull nomic-embed-text` before picking that one."
    ),
    "summarize_model_cheap": (
        "Local, fast Ollama model. Powers Ask (the cmd-K drawer) and any "
        "light summarisation / link-grooming work. Optimise for latency."
    ),
    "summarize_model_heavy": (
        "Heavier Ollama model — cloud-proxied or a larger local checkpoint. "
        "Reserved for multi-source synthesis jobs. Optimise for quality."
    ),
}


class BudgetIn(BaseModel):
    scout: int = Field(ge=0, le=100000)
    listener: int = Field(ge=0, le=100000)
    compiler: int = Field(ge=0, le=100000)
    linter: int = Field(ge=0, le=100000)
    synthesizer: int = Field(ge=0, le=100000)


class SettingsIn(BaseModel):
    claude_cmd: str | None = None

    ollama_local_url: str | None = None
    ollama_local_only: bool | None = None
    ollama_cloud_url: str | None = None
    # Empty string = clear. None / omitted = leave unchanged.
    # Non-empty value = store.
    ollama_cloud_key: str | None = None

    embed_model: str | None = None
    summarize_model_cheap: str | None = None
    summarize_model_heavy: str | None = None

    budget: BudgetIn | None = None


@router.get("/settings")
def read_settings():
    """Return the current effective settings. Cloud key is masked."""
    s = get_settings()
    return {
        "values": {
            "claude_cmd": s.claude_cmd,
            "ollama_local_url": s.ollama_local_url,
            "ollama_local_only": s.ollama_local_only,
            "ollama_cloud_url": s.ollama_cloud_url,
            # Never return the raw key — just whether it's set.
            "ollama_cloud_key_set": bool(s.ollama_cloud_key),
            "embed_model": s.embed_model,
            "summarize_model_cheap": s.summarize_model_cheap,
            "summarize_model_heavy": s.summarize_model_heavy,
            "budget": {
                "scout": s.budget.scout,
                "listener": s.budget.listener,
                "compiler": s.budget.compiler,
                "linter": s.budget.linter,
                "synthesizer": s.budget.synthesizer,
            },
        },
        "model_roles": MODEL_ROLES,
        "config_path": str(config_path()),
        "cloud_active": bool(s.ollama_cloud_key) and not s.ollama_local_only,
    }


@router.post("/settings")
def write_settings(body: SettingsIn):
    """Merge supplied fields into config.toml, then reload the settings cache."""
    path = config_path()
    existing: dict[str, Any] = {}
    if path.exists():
        try:
            with path.open("rb") as f:
                existing = tomllib.load(f)
        except Exception as e:
            raise HTTPException(500, f"could not parse existing config.toml: {e}")

    patch = body.model_dump(exclude_none=True)

    # Ollama key: empty string means "clear the key"; anything else is a new value.
    if "ollama_cloud_key" in patch:
        val = patch.pop("ollama_cloud_key")
        if val == "":
            existing.pop("ollama_cloud_key", None)
        else:
            existing["ollama_cloud_key"] = val

    if "budget" in patch:
        existing["budget"] = {**existing.get("budget", {}), **patch.pop("budget")}

    existing.update(patch)

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_dump_toml(existing))
    except Exception as e:
        raise HTTPException(500, f"could not write config.toml: {e}")

    reload_settings()
    return {"ok": True}


# ───── minimal TOML writer ─────

def _dump_toml(data: dict[str, Any]) -> str:
    """Write a flat config.toml with one nested [budget] table.

    Deliberately narrow — covers the fields we actually accept. Preserves
    neither comments nor unknown tables, but the file is machine-managed
    from here on anyway.
    """
    out: list[str] = [
        "# Mastisk config — written by the Settings page. Safe to edit by hand.",
        "# Secrets live here (never in the iCloud vault).",
        "",
    ]
    scalar_keys = [k for k, v in data.items() if not isinstance(v, dict)]
    for k in scalar_keys:
        out.append(f"{k} = {_toml_scalar(data[k])}")
    table_keys = [k for k, v in data.items() if isinstance(v, dict)]
    for k in table_keys:
        out.append("")
        out.append(f"[{k}]")
        for sk, sv in data[k].items():
            out.append(f"{sk} = {_toml_scalar(sv)}")
    out.append("")
    return "\n".join(out)


def _toml_scalar(v: Any) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        # json.dumps handles escaping + quoting correctly for TOML basic strings
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ", ".join(_toml_scalar(x) for x in v) + "]"
    raise TypeError(f"unsupported config value type: {type(v).__name__}")


# ───── GitHub PAT management ─────

class SetGithubPatRequest(BaseModel):
    pat: str   # empty string clears


def _mask_pat(pat: str) -> str | None:
    return ("…" + pat[-4:]) if len(pat) >= 4 else None


@router.get("/settings/github")
async def get_github_settings() -> dict:
    """Return GitHub settings WITHOUT leaking the full PAT."""
    s = get_settings().github
    pat = s.pat or ""
    return {
        "pat_set": bool(pat),
        "pat_last4": _mask_pat(pat),
        "poll_interval_minutes": s.poll_interval_minutes,
        "ideate_min_interval_hours": s.ideate_min_interval_hours,
        "ideas_per_run": s.ideas_per_run,
    }


@router.put("/settings/github/pat")
async def set_github_pat(req: SetGithubPatRequest) -> dict:
    """Persist the GitHub PAT to config.toml and reload settings."""
    update_toml_key("github", "pat", req.pat)
    reload_settings()
    s = get_settings().github
    return {
        "pat_set": bool(s.pat),
        "pat_last4": _mask_pat(s.pat or ""),
    }


@router.get("/settings/github/test")
async def test_github_pat() -> dict:
    """Hit GET /user with the current PAT. Returns username on success, error description on failure."""
    pat = get_settings().github.pat
    if not pat:
        raise HTTPException(status_code=422, detail="no PAT configured")
    try:
        async with httpx.AsyncClient(base_url="https://api.github.com", timeout=10.0) as client:
            resp = await client.get("/user", headers={
                "Authorization": f"Bearer {pat}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "mastisk-pat-test/0.1",
            })
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"network error: {e}")
    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="PAT is invalid")
    if resp.status_code == 403:
        raise HTTPException(status_code=403, detail="PAT lacks required scope or is rate-limited")
    if not resp.is_success:
        raise HTTPException(status_code=502, detail=f"GitHub returned {resp.status_code}")
    data = resp.json()
    return {
        "ok": True,
        "username": data.get("login"),
        "name": data.get("name"),
        "public_repos": data.get("public_repos"),
    }

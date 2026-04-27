"""System status — for `mastisk status` CLI and in-dashboard health card."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from mastisk.db.queries import connect
from mastisk.paths import self_dir, vault_dir, vault_is_icloud
from mastisk.settings import get_settings

router = APIRouter(tags=["stats"])


@router.get("/stats")
def stats():
    with connect() as conn:
        counts = {
            "articles":         conn.execute("SELECT COUNT(*) AS n FROM articles").fetchone()["n"],
            "sources":          conn.execute("SELECT COUNT(*) AS n FROM sources").fetchone()["n"],
            "links":            conn.execute("SELECT COUNT(*) AS n FROM links").fetchone()["n"],
            "feed_entries":     conn.execute("SELECT COUNT(*) AS n FROM feed").fetchone()["n"],
            "signals":          conn.execute("SELECT COUNT(*) AS n FROM signals").fetchone()["n"],
        }
        feeds = conn.execute(
            "SELECT COUNT(*) AS n FROM subscriptions WHERE kind='rss' AND enabled=1"
        ).fetchone()["n"]
        jobs_by_status = {
            r["status"]: r["n"] for r in conn.execute(
                "SELECT status, COUNT(*) AS n FROM jobs GROUP BY status"
            )
        }
        last_feed_fetch = conn.execute(
            "SELECT MAX(last_fetched) AS t FROM subscriptions WHERE kind='rss' AND enabled=1"
        ).fetchone()["t"]
        last_agent_activity = conn.execute(
            "SELECT MAX(ts) AS t FROM feed"
        ).fetchone()["t"]

    self_files_present = {
        name: (self_dir() / f"{name}.md").exists()
        for name in ("identity", "interests", "dislikes", "style", "learnings")
    }

    s = get_settings()
    return {
        "counts": counts,
        "feeds_enabled": feeds,
        "jobs": jobs_by_status,
        "last_feed_fetch": last_feed_fetch,
        "last_agent_activity": last_agent_activity,
        "self_files": self_files_present,
        "vault": {
            "path":   str(vault_dir()),
            "icloud": vault_is_icloud(),
        },
        "llm": {
            "claude_cmd":       s.claude_cmd,
            "ollama_local_url": s.ollama_local_url,
            "ollama_cloud":     bool(s.ollama_cloud_key) and not s.ollama_local_only,
            "embed_model":      s.embed_model,
            "summarize_cheap":  s.summarize_model_cheap,
            "summarize_heavy":  s.summarize_model_heavy,
        },
    }


@router.post("/stats/ping-bridges")
async def ping_bridges():
    """Smoke-test both bridges with minimal prompts. Returns ok/fail per bridge."""
    from mastisk.bridges import claude_bridge, ollama_bridge

    async def ping_claude():
        try:
            r = await asyncio.wait_for(
                claude_bridge.run_claude('Reply with exactly: OK', timeout_s=60),
                timeout=60,
            )
            return {"ok": True, "sample": r["text"][:80]}
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

    async def ping_ollama():
        try:
            out = await asyncio.wait_for(ollama_bridge.chat("ping", cheap=True), timeout=30)
            return {"ok": True, "sample": out[:80]}
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

    async def ping_embed():
        try:
            vecs = await asyncio.wait_for(ollama_bridge.embed(["ping"]), timeout=20)
            return {"ok": True, "dim": len(vecs[0]) if vecs and vecs[0] else 0}
        except Exception as e:
            return {"ok": False, "error": str(e)[:200]}

    claude_r, ollama_r, embed_r = await asyncio.gather(ping_claude(), ping_ollama(), ping_embed())
    return {
        "claude":       claude_r,
        "ollama_chat":  ollama_r,
        "ollama_embed": embed_r,
    }

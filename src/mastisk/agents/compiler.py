"""Compiler — turns a raw source into a structured wiki article via Claude.

Loads identity from `vault/_self/*.md` as system context. Prompts Claude for a JSON
response matching the article schema; writes into SQLite + mirrors to vault/.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from slugify import slugify

from mastisk.agents.base import Agent
from mastisk.bridges import claude_bridge
from mastisk.db import queries as q
from mastisk.db.queries import connect
from mastisk.paths import vault_dir

log = logging.getLogger("mastisk.compiler")

SCHEMA_MD = """
Return a single JSON object in a ```json``` fenced block, matching this shape:

```json
{
  "skip": false,
  "skip_reason": "",
  "id": "lowercase-slug",
  "kind": "Concept | Entity | Source | Synthesis",
  "title": "Human-readable title",
  "aka": ["alternate name 1", "alternate name 2"],
  "summary": "1–2 sentence italic summary. Leads the article.",
  "confidence": 0.0,
  "reading_minutes": 5,
  "sections": [
    {"h": "TL;DR", "kind": "callout", "body": "HTML-safe paragraph."},
    {"h": "Mechanism", "body": "HTML-safe paragraph. Use <span class=\\"link\\" data-target=\\"slug\\">wiki link</span> for cross-references."},
    {"h": "Open questions", "kind": "open", "body": "HTML-safe paragraph."}
  ],
  "related": [
    {"id": "other-slug", "label": "Other concept", "weight": 0.8}
  ]
}
```

Rules:
- If the source isn't relevant to the user's interests (see their profile above), set "skip": true and "skip_reason": "...".
- "id" and slugs must be kebab-case, ASCII, no spaces.
- Weight in [0, 1]. Confidence in [0, 1] — your subjective calibration of how solid this page is.
- Never invent sources you didn't see. Never hallucinate URLs.
- Write body text in HTML. Use <em> for emphasis, <span class="link" data-target="slug"> for cross-references.
- Match the user's writing style from their profile.
"""


class Compiler(Agent):
    name = "compiler"
    tick_seconds = 300  # 5 min

    # Drain up to this many jobs per tick. Keeps a single tick bounded so a
    # giant backlog can't monopolise the scheduler; APScheduler's max_instances=1
    # prevents overlap with the next tick anyway.
    max_jobs_per_tick = 20

    async def run_once(self) -> None:
        for _ in range(self.max_jobs_per_tick):
            job = self._pick_job()
            if not job:
                return
            log.info("%s: picking job %s (%s)", self.name, job["id"], job["kind"])
            self._mark_running(job["id"])
            try:
                await self._handle(job)
                self._mark_done(job["id"])
            except Exception as e:
                log.exception("%s: job %s failed", self.name, job["id"])
                self._mark_failed(job["id"], str(e))

    async def _handle(self, job: dict) -> None:
        payload = json.loads(job["payload_json"] or "{}")
        source_id = payload.get("source_id")
        if not source_id:
            log.warning("compiler: no source_id in job %s", job["id"])
            return

        with connect() as conn:
            src = conn.execute(
                "SELECT id, kind, url, title, raw_path FROM sources WHERE id=?",
                (source_id,),
            ).fetchone()
        if not src:
            log.warning("compiler: source %s not found", source_id)
            return

        raw_text = Path(src["raw_path"]).read_text() if src["raw_path"] else (src["title"] or "")
        identity = self.load_identity()

        prompt = (
            f"You are Mastisk's Compiler. Transform the raw source below into a wiki article.\n\n"
            f"{identity}\n\n"
            f"# Raw source\nTitle: {src['title']}\nURL: {src['url']}\nKind: {src['kind']}\n\n"
            f"{raw_text[:8000]}\n\n"
            f"{SCHEMA_MD}"
        )

        resp = await claude_bridge.run_claude(prompt)
        data = claude_bridge.extract_json_block(resp["text"])
        if not data:
            log.warning("compiler: no JSON block in claude response for source %s", source_id)
            return

        if data.get("skip"):
            self.emit_feed(verb="skipped", obj=src["title"][:80], kind="compile",
                           payload={"source_id": source_id, "reason": data.get("skip_reason")})
            return

        # Guard against mis-classification: a single-source article is almost
        # never a genuine Synthesis — that kind is reserved for cross-source
        # weaving. Demote to Concept so the UI counts stay meaningful.
        if data.get("kind") == "Synthesis":
            data["kind"] = "Concept"

        self._persist_article(data, source_id=source_id)
        self.emit_feed(
            verb="wrote" if self._is_new(data["id"]) else "updated",
            obj=data["title"][:80],
            kind=data["kind"].lower(),
            touched=1,
            payload={"article_id": data["id"], "source_id": source_id},
        )

    def _is_new(self, article_id: str) -> bool:
        with connect() as conn:
            return conn.execute("SELECT 1 FROM articles WHERE id=?", (article_id,)).fetchone() is None

    def _persist_article(self, data: dict, *, source_id: str) -> None:
        article_id = data["id"]
        slug = slugify(data["title"])[:80] or article_id
        vault_path = self._vault_path_for(data["kind"], slug)

        with connect() as conn, q.txn(conn):
            q.upsert_article(conn, {
                "id": article_id,
                "kind": data["kind"],
                "title": data["title"],
                "slug": slug,
                "aka": data.get("aka", []),
                "summary": data.get("summary", ""),
                "body_md": _sections_to_md(data.get("sections", [])),
                "confidence": float(data.get("confidence", 0.6)),
                "reading_minutes": int(data.get("reading_minutes", 5)),
                "updated_by": "Compiler",
                "vault_path": str(vault_path),
            })
            q.replace_sections(conn, article_id, data.get("sections", []))
            q.set_related(conn, article_id, data.get("related", []))
            conn.execute(
                "INSERT OR IGNORE INTO article_sources (article_id, source_id) VALUES (?, ?)",
                (article_id, source_id),
            )

        # Mirror to vault
        vault_path.parent.mkdir(parents=True, exist_ok=True)
        vault_path.write_text(_render_markdown(data))

    def _vault_path_for(self, kind: str, slug: str) -> Path:
        folder = {
            "Concept": "concepts",
            "Entity": "entities",
            "Source": "sources",
            "Synthesis": "synthesis",
        }.get(kind, "concepts")
        return vault_dir() / folder / f"{slug}.md"


def _sections_to_md(sections: list[dict]) -> str:
    out: list[str] = []
    for s in sections:
        out.append(f"## {s.get('h', '')}\n")
        out.append(_strip_html(s.get("body", "")))
        out.append("")
    return "\n".join(out)


def _strip_html(html: str) -> str:
    # Preserve link targets as markdown-like refs
    s = re.sub(r'<span class="link" data-target="([^"]+)">([^<]+)</span>', r"[[\2|\1]]", html)
    s = re.sub(r"<em>([^<]+)</em>", r"*\1*", s)
    s = re.sub(r"<[^>]+>", "", s)
    return s


def _render_markdown(data: dict) -> str:
    lines = [
        "---",
        f"id: {data['id']}",
        f"kind: {data['kind']}",
        f"title: {data['title']}",
        f"confidence: {data.get('confidence', 0.6)}",
        f"reading_minutes: {data.get('reading_minutes', 5)}",
        "---",
        "",
        f"# {data['title']}",
        "",
        f"*{data.get('summary', '')}*",
        "",
        _sections_to_md(data.get("sections", [])),
    ]
    return "\n".join(lines)

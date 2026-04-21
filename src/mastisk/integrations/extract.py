"""Entity extraction over a transcript via Claude.

Prompts Claude to return a structured JSON block describing summary, chapters,
people, books, concepts, and organizations. Failure is benign — callers fall
back to an empty shape rather than crashing the ingest.
"""
from __future__ import annotations

import logging

from mastisk.bridges import claude_bridge

log = logging.getLogger("mastisk.extract")

_MAX_TRANSCRIPT_CHARS = 100_000

_SCHEMA_MD = """
Return a single JSON object in a ```json``` fenced block with this shape:

```json
{
  "summary": "2-3 sentence overview of the episode/video.",
  "chapters": [
    {"heading": "Section title", "start_min": 0, "body_preview": "1-line gist of the section."}
  ],
  "people": [
    {"name": "Full name", "role": "host | guest | mentioned", "note": "optional short context"}
  ],
  "books": [
    {"title": "Book title", "author": "First author or null", "context": "1-line why it was mentioned"}
  ],
  "concepts": ["concept phrase", "another concept"],
  "organizations": ["company or institution name"]
}
```

Rules:
- If a field has no reasonable entries, return an empty list (or empty string for summary).
- Chapters: only fill if you can confidently infer structure. Otherwise return [].
- start_min is an integer minute offset or null.
- Books: only include works explicitly referenced as books. Don't invent authors.
- People: include hosts, guests, and anyone quoted or discussed at length.
- concepts: short noun phrases the transcript actually explores (not filler words).
"""


async def extract_entities(transcript: str, source_context: dict) -> dict:
    """Return the structured entities dict. Never raises — failures return the
    empty shape so the ingest can still proceed."""
    empty = {
        "summary": "",
        "chapters": [],
        "people": [],
        "books": [],
        "concepts": [],
        "organizations": [],
    }
    if not transcript or not transcript.strip():
        return empty

    body = transcript[:_MAX_TRANSCRIPT_CHARS]
    ctx_lines = [f"{k}: {v}" for k, v in source_context.items() if v]
    ctx_block = "\n".join(ctx_lines) if ctx_lines else "(no context provided)"

    prompt = (
        "You are Mastisk's knowledge-wiki entity extractor. You receive a "
        "podcast or YouTube transcript and must pull out the books, people, "
        "concepts, and organizations it discusses, plus a brief summary. "
        "Stay faithful to the text — do not invent authors, roles, or citations.\n\n"
        f"# Source context\n{ctx_block}\n\n"
        f"<transcript>\n{body}\n</transcript>\n\n"
        f"{_SCHEMA_MD}"
    )

    try:
        resp = await claude_bridge.run_claude(prompt, timeout_s=300)
    except Exception as e:
        log.warning("extract: claude call failed: %s", e)
        return empty
    data = claude_bridge.extract_json_block(resp.get("text") or "")
    if not isinstance(data, dict):
        log.info("extract: no JSON block in claude reply")
        return empty
    # Fill in any missing keys with empty defaults so downstream consumers
    # don't need to guard every access.
    return {
        "summary": str(data.get("summary") or ""),
        "chapters": list(data.get("chapters") or []),
        "people": list(data.get("people") or []),
        "books": list(data.get("books") or []),
        "concepts": list(data.get("concepts") or []),
        "organizations": list(data.get("organizations") or []),
    }

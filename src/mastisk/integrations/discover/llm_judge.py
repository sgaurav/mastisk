"""Final relevance pass — single batched Claude call to score the
finalist Candidates 1–10. Cycle keeps survivors with score ≥ MIN_SCORE.

ON by default (DiscoverSettings.llm_judge_enabled). The user can toggle off
in Settings → Discovery if they don't want to spend a Claude call per
cycle.
"""
from __future__ import annotations

import json
import logging

from mastisk.agents.base import Agent
from mastisk.bridges import claude_bridge

from . import Candidate

log = logging.getLogger("mastisk.discover.llm_judge")

MIN_SCORE = 7
MAX_BATCH = 50


async def score_batch(candidates: list[Candidate]) -> dict[str, int]:
    """Return {url: score 1-10} for each candidate. URLs missing from the
    return mean Claude failed to score them — caller should treat as 0."""
    if not candidates:
        return {}

    items = candidates[:MAX_BATCH]
    identity = Agent.load_identity()

    # Build a compact, machine-friendly listing
    lines = []
    for i, c in enumerate(items, 1):
        path_summaries = "; ".join(p.snippet for p in c.trust_paths[:3])
        title = (c.title or c.url)[:120]
        lines.append(
            f"{i}. URL: {c.url}\n"
            f"   Title: {title}\n"
            f"   Source kind: {c.source_kind}; surfaced via {c.kind}\n"
            f"   Trust path: {path_summaries}\n"
        )
    listing = "\n".join(lines)

    prompt = f"""{identity}

You are scoring candidate sources for the user's personal knowledge wiki.
The user has already chosen their subscriptions; these candidates were
surfaced because they're endorsed by people the user follows (cited,
recommended, or repeatedly hitting community curation). Your job is to
filter out noise — items that look plausible but are SEO bait,
content-farm summaries, AI-generated junk, or off-topic for this user.

For each item below, score 1–10 where:
- 9–10: directly relevant to the user's interests AND from a clearly
  primary-source author (researcher, practitioner, primary blog).
- 7–8: relevant; reasonable signal-to-noise; worth surfacing.
- 4–6: tangentially related or quality is uncertain.
- 1–3: noise, spam, derivative, or off-topic.

Return ONLY a JSON object mapping URL → integer score. No prose, no
explanation. Example:

```json
{{"https://example.com/a": 8, "https://example.com/b": 3}}
```

Candidates ({len(items)}):

{listing}
"""
    try:
        resp = await claude_bridge.run_claude(prompt=prompt, timeout_s=120)
    except Exception as e:
        log.warning("llm_judge: Claude call failed (%s); passing all candidates through", e)
        # If the judge fails, don't drop everything — let the orchestrator
        # surface based on confluence alone.
        return {c.url: MIN_SCORE for c in items}

    text = resp.get("text", "") if isinstance(resp, dict) else str(resp)
    block = claude_bridge.extract_json_block(text)
    if block is None:
        # Try a second pass: maybe it's just a JSON object inline
        try:
            block = json.loads(text.strip())
        except Exception:
            log.warning("llm_judge: couldn't parse Claude response; passing through")
            return {c.url: MIN_SCORE for c in items}

    out: dict[str, int] = {}
    if isinstance(block, dict):
        for k, v in block.items():
            try:
                out[k] = max(1, min(10, int(v)))
            except (TypeError, ValueError):
                continue
    log.info("llm_judge: scored %d/%d candidates", len(out), len(items))
    return out

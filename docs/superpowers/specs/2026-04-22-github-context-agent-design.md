# GitHub Context Agent — Design Spec

**Status:** Draft (autonomous, pending user review)
**Author:** Sushil + Claude Opus 4.7
**Date:** 2026-04-22
**Scope:** Third of three compounding subsystems (Notes + Roundtable shipped).

---

## 1. Context & Goals

Per the user's brief: *"I want a way to connect my GitHub so that it builds context around the repo which I have shared. The new things I am working on, plus how it is evolving, and bring new ideas to me around it daily."*

Mastisk will ingest GitHub repositories the user designates, build an evolving context record per repo (README + recent commits + open issues + PRs), and generate daily idea prompts — written into the Notes pipeline so they're classified, linkable, escalatable, and optionally run through the Roundtable.

**Goals:**
1. User registers repos by `owner/repo` slug; GitHub authentication via a personal access token (PAT) stored in config.
2. A background agent polls each repo hourly, snapshots high-signal state (README, recent commits, open issues/PRs), and derives a rolling context document.
3. A daily ideation agent consumes repo context + user identity and writes N fresh idea-notes per repo into `vault/_notes/inbox/` (picked up by the Notetaker).
4. Graceful degradation: no PAT = public repos still work (rate-limited); a failing repo (deleted, private without token) surfaces as a feed row, not a crash.

**Success criteria:**
- `mastisk add-repo anthropics/claude-code` → row exists, first snapshot completes within 60s.
- Hourly ticks refresh the snapshot without hammering GitHub (ETag/If-Modified-Since where the API supports it).
- Daily ideation runs once per 24h per repo; produces 3-5 notes classified into the system.
- Removing a repo tombstones its snapshots; ideas already written as notes stay.

---

## 2. Non-Goals (v1)

- Two-way interaction with GitHub (commenting, creating issues, PR automation).
- Repo clone + local code analysis (too heavy; context is API-only).
- Realtime webhook ingestion (hourly polling is sufficient for single-user ideation cadence).
- Multi-user repo auth (single PAT, single user).
- Language-specific code understanding.
- GitHub Enterprise (only `github.com` for v1).
- Generating ideas in any format other than notes.

---

## 3. Architecture

```
Config (PAT)                GitHub API                Per-repo state                   Daily ideation
────────────                ──────────                ───────────────                   ──────────────
                            ┌─────────────┐          ┌────────────────────┐         ┌────────────────────┐
repos table ──poll hourly──►│ httpx client│◄─────────►│ repo_snapshots      │────────►│ ideas agent (Claude│
(owner/repo)                │ (gh_bridge) │          │ time-series rows    │         │  or Ollama)        │
                            └─────────────┘          │ + ``context_md``    │         └────────┬───────────┘
                                                     └─────────────────────┘                  │ writes
                                                                                               ▼
                                                                                       ┌───────────────┐
                                                                                       │ _notes/inbox/ │
                                                                                       └───────┬───────┘
                                                                                               │
                                                                                               ▼
                                                                                   existing Notetaker pipeline
                                                                                   (classify → escalate → roundtable)
```

**Two agents, not one:**
- `GithubPoller` — runs every 60min per repo. Fetches README + recent commits + open issues + open PRs; writes a `repo_snapshots` row and updates the rolling `context_md` summary.
- `GithubIdeator` — runs every 60min but only ACTS if ≥24h since the last ideation for the repo. Reads the latest snapshot, composes an LLM prompt, writes 3-5 idea notes to `_notes/inbox/` via the existing Phase 1 atomic-write helper.

The two are separate agents (rather than one combined agent) so polling cadence and ideation cadence evolve independently, and so a polling failure doesn't block ideation and vice versa.

---

## 4. Components

| kind | path | new? | purpose |
|---|---|---|---|
| Bridge | `src/mastisk/bridges/github_bridge.py` | new | httpx client around GitHub REST v3 (repo metadata, commits, issues, PRs, README). Respects rate limits. |
| Agent | `src/mastisk/agents/github_poller.py` | new | Hourly poll loop; writes `repo_snapshots`, updates `repos.context_md`. |
| Agent | `src/mastisk/agents/github_ideator.py` | new | Daily ideation; writes idea-notes to inbox. |
| API route | `src/mastisk/routes/repos_route.py` | new | POST/GET/DELETE for managed repos. |
| CLI | `src/mastisk/cli.py` | edit | `mastisk add-repo`, `mastisk list-repos`, `mastisk remove-repo`. |
| DB schema | `src/mastisk/db/schema.sql` | edit | Three new tables: `repos`, `repo_snapshots`, `repo_idea_runs`. |
| Settings | `src/mastisk/settings.py` | edit | `GithubSettings` (pat, ideas_per_day, poll_interval_minutes). |
| Frontend | `frontend/src/components/ReposView.tsx`, `RepoDetailView.tsx`, `AddRepoModal.tsx` | new | Repo list, detail, add modal. |
| Frontend | `frontend/src/types.ts`, `router.ts`, `api.ts`, `App.tsx`, `Sidebar.tsx` | edit | Wire. |
| Scheduler | `src/mastisk/scheduler.py` | edit | Register two new agents. |

---

## 5. Database Schema

Append to `src/mastisk/db/schema.sql`:

```sql
-- ─────────────────────────────── GitHub ───────────────────────────────
-- Repos the user has registered for ingestion. The user refers to them as
-- 'owner/repo' slugs; we normalize to lowercase on insert.

CREATE TABLE IF NOT EXISTS repos (
  slug           TEXT PRIMARY KEY,       -- 'owner/repo' lowercased
  owner          TEXT NOT NULL,
  name           TEXT NOT NULL,
  display_name   TEXT,                   -- 'Owner/Repo' with original casing if we have it
  description    TEXT,
  default_branch TEXT,
  is_private     INTEGER NOT NULL DEFAULT 0,
  added_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_polled_at DATETIME,
  last_ideated_at DATETIME,
  context_md     TEXT,                   -- rolling context, rewritten by the Poller each snapshot
  deleted_at     DATETIME                -- tombstone; history rows kept for audit
);

CREATE INDEX IF NOT EXISTS idx_repos_added ON repos(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_repos_not_deleted ON repos(slug) WHERE deleted_at IS NULL;

-- One row per poll tick per repo. Append-only history (never UPDATE).
CREATE TABLE IF NOT EXISTS repo_snapshots (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_slug          TEXT NOT NULL REFERENCES repos(slug) ON DELETE CASCADE,
  polled_at          DATETIME NOT NULL,
  latest_commit_sha  TEXT,
  latest_commit_at   DATETIME,
  open_issues_count  INTEGER,
  open_prs_count     INTEGER,
  stars_count        INTEGER,
  forks_count        INTEGER,
  commits_json       TEXT,                -- JSON array of last 20 commits (sha, message, author, date)
  issues_json        TEXT,                -- JSON array of ≤10 open issues (title, number, labels)
  prs_json           TEXT,                -- JSON array of ≤10 open PRs (title, number, author)
  readme_hash        TEXT,                -- sha256; lets us skip re-summarizing if unchanged
  readme_excerpt     TEXT,                -- first 2000 chars
  error              TEXT                 -- set if the poll failed
);

CREATE INDEX IF NOT EXISTS idx_repo_snapshots_repo ON repo_snapshots(repo_slug, polled_at DESC);

-- One row per ideation run per repo. Tracks what was generated + the note_ids.
CREATE TABLE IF NOT EXISTS repo_idea_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_slug      TEXT NOT NULL REFERENCES repos(slug) ON DELETE CASCADE,
  ideated_at     DATETIME NOT NULL,
  snapshot_id    INTEGER REFERENCES repo_snapshots(id) ON DELETE SET NULL,
  note_ids_json  TEXT,                    -- JSON array of note_ids written this run
  model          TEXT,                    -- 'claude' | 'ollama'
  error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_repo_idea_runs_repo ON repo_idea_runs(repo_slug, ideated_at DESC);
```

---

## 6. API Surface

```
POST   /api/repos
       body: {"slug": "owner/repo"}
       → 201, {"slug": "...", "owner": "...", "name": "...", "description": "..."}
       Validates the repo exists on GitHub (single HEAD or metadata fetch). 404 if not.

GET    /api/repos
       → 200, [{slug, display_name, description, last_polled_at, last_ideated_at, snapshot_count, idea_run_count}, ...]

GET    /api/repos/{owner}/{name}
       → 200, {repo details + latest snapshot summary + recent idea_runs}

DELETE /api/repos/{owner}/{name}
       → 204, soft-deletes (sets deleted_at); keeps historical snapshots and notes.

POST   /api/repos/{owner}/{name}/poll-now
       → 202, {"ok": true}   — enqueues an immediate poll (bypasses hourly cadence)

POST   /api/repos/{owner}/{name}/ideate-now
       → 202, {"ok": true}   — enqueues an immediate ideation (bypasses daily cadence)
```

---

## 7. Settings (`config.toml`)

```toml
[github]
# Personal access token. Create at https://github.com/settings/tokens (classic → public_repo scope
# for public-only, or repo scope if you need private repo access). Leave blank to poll only public
# repos at GitHub's unauthenticated rate limit (60 req/hour).
pat = ""

# Poll each repo every N minutes. 60 = hourly. 15 = aggressive.
poll_interval_minutes = 60

# Run the ideation agent every N minutes, but only emit ideas for a repo whose
# last_ideated_at is older than `ideate_min_interval_hours`.
ideate_tick_minutes = 60
ideate_min_interval_hours = 24

# Number of fresh idea-notes to write per repo per ideation run.
ideas_per_run = 4

# Model to use for ideation. Falls back to Ollama on Claude failure.
ideate_model = "claude-sonnet-4-6"
```

`GithubSettings` pydantic model nested under `Settings.github`.

---

## 8. Polling Behavior

`GithubPoller` agent `_handle(job)` — one repo per job.

1. Load repo row. Skip if tombstoned.
2. Fetch in parallel:
   - `GET /repos/{owner}/{name}` → metadata (description, default_branch, stars, forks, private)
   - `GET /repos/{owner}/{name}/commits?per_page=20` → recent commits
   - `GET /repos/{owner}/{name}/issues?state=open&per_page=10` → open issues (excluding PRs — the `issues` endpoint returns both; filter where `pull_request` key is absent)
   - `GET /repos/{owner}/{name}/pulls?state=open&per_page=10` → open PRs
   - `GET /repos/{owner}/{name}/readme` → base64-encoded README
3. If any request fails (429, network error, 404 on deleted repo), write a snapshot row with `error` set and return without updating `context_md`.
4. On success: compute README hash; if unchanged since last snapshot, reuse the previous `context_md`'s README section verbatim (save an LLM call). Otherwise regenerate the "README summary" portion via a lightweight Ollama call.
5. Compose a new `context_md` (plain markdown) with sections:
   - **About** — description + star/fork counts + privacy flag
   - **README summary** — 2-3 paragraph LLM summary (Ollama) or cached
   - **Recent activity** — bulleted list of last 10 commits (first line only) + any notable issues/PRs by title
6. Upsert to `repos.context_md` + update `last_polled_at`.
7. Insert a `repo_snapshots` row with the raw commits/issues/prs JSON (so historical queries can inspect what was current at any point).

`GithubPoller.run_once`:
- Query non-tombstoned repos where `last_polled_at IS NULL` OR `last_polled_at < now - poll_interval_minutes`.
- Enqueue one job per due repo. Process one job per tick (base `Agent.run_once`).

Rate-limit handling: the `github_bridge` tracks the `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers; if `remaining <= 5`, the poller agent logs a warning and defers the poll by re-inserting the job with a delay (via `escalation_next_attempt_at` style — a `scheduled_for` column could be added to `jobs` but v1 keeps it simple: just skip if rate-limited, try next tick).

---

## 9. Ideation Behavior

`GithubIdeator` agent `_handle(job)`:

1. Load repo. Skip if tombstoned OR `last_ideated_at > now - ideate_min_interval_hours`.
2. Read latest `repo_snapshots` row. If `error`, skip (wait for a good poll).
3. Compose prompt (see §10).
4. Call Claude (or Ollama fallback) asking for N ideas as JSON.
5. For each idea:
   - Format as a note body: short title + framing (~3-5 sentences) + optional "possible angles" list.
   - Write to `vault/_notes/inbox/<HHMMSS>-<slug>.md` via `atomic_write` (reuses Phase 1 helpers).
   - Insert `notes` row with `source='file'`, path pointing at the file.
6. Batch-insert all note_ids into the `repo_idea_runs` row.
7. Update `repos.last_ideated_at = now`.
8. Emit feed row: `agent='github_ideator', verb='ideated', obj=repo_slug, payload={note_count}`.

The Notetaker agent then picks up the inbox files on its next 30s scan, classifies them, and the Escalator may auto-research them.

**Compounding at its best:** the GitHub agent's output is indistinguishable from a user-authored note. Everything downstream just works — classification, escalation, roundtable, daily digest.

`GithubIdeator.run_once`:
- Query non-tombstoned repos where `last_ideated_at IS NULL` OR `last_ideated_at < now - ideate_min_interval_hours * 3600`, AND where a non-error snapshot exists.
- Enqueue one job per due repo. Serial processing (one per tick).

---

## 10. Ideation Prompt

```
You are generating fresh research ideas for a user based on a GitHub repository they've asked you to track.

## About the user
{identity}

## Repository
slug: {slug}
description: {description}
stars/forks: {stars} / {forks}

## Rolling context
{context_md}

## Your job
Generate EXACTLY {ideas_per_run} distinct, specific, research-worthy ideas. Each idea should be something the user would find interesting to think about given their stated interests — NOT a generic "consider X". Tie each idea to something concrete from the context (a recent commit message, an open issue, a README claim, etc.).

Respond with a single JSON array — no prose, no markdown, no preamble:

[
  {{
    "title": "short noun phrase, max 60 chars",
    "framing": "2-4 sentences that frame the idea concretely. Reference the specific commit/issue/README claim that triggered it.",
    "angles": ["angle 1", "angle 2"],
    "tags": ["tag-a", "tag-b"]
  }},
  ...
]

Rules:
- Use the user's writing style (see their profile).
- Ideas must be distinct — no near-duplicates across entries.
- "angles" are 2-3 bullet directions someone could explore; keep them crisp.
- "tags" are 1-3 lowercased kebab-case topic tags.
- Avoid generic ideas ("write a blog post about X"); aim for research threads.
```

Each idea becomes a separate note body:

```markdown
> From repo: {slug}

# {title}

{framing}

## Angles
- {angle_1}
- {angle_2}
- {angle_3}

tags: {tag_list}
```

The `> From repo:` preamble is the analog of Phase 1.5's `> From article:` — the Notetaker reads it and links the resulting note back to the repo's existing article stub (if one exists) or to a repo-tracking page (see §13 Compounding).

---

## 11. Error Handling

| case | handling |
|---|---|
| PAT missing, repo is public | Poll unauthenticated. Hit 60 req/hr limit → re-queue with delay. |
| PAT missing, repo is private | Metadata fetch returns 404; add-repo rejects with "can't see this repo — add a PAT with repo scope". |
| PAT invalid | All API calls return 401. Surface a prominent feed row `agent='github_poller', verb='auth-failed'`. Stop polling all repos until the user updates the config. |
| Repo deleted on GitHub | 404 on metadata. Write a snapshot row with `error='repo not found'`. Don't tombstone automatically — the user may not realize, and re-adding is cheap. Surface as a feed row. |
| Rate limit hit mid-tick | Log warning, skip remaining repos, retry next tick. |
| Ollama unavailable for README summary | Fall back to the raw first 1000 chars of README as the summary. |
| Claude unavailable for ideation | Fall back to Ollama. If Ollama also fails, record `error` on the idea_run row and try next tick. |
| Idea parse failure (non-JSON response) | Log + retry once with a strict re-prompt. Then error-out that run. |
| User removes a repo mid-poll | `ON DELETE CASCADE` on `repo_snapshots` handles it; a mid-flight poll that tries to insert hits the deleted row → log + move on. |

---

## 12. Testing Strategy

Bridge tests mock `httpx.AsyncClient` responses.

Agent tests mock the bridge AND the LLM calls.

- `test_github_bridge.py` — repo metadata parsing, rate-limit header extraction, 404/401 branches.
- `test_github_poller.py` — single-repo poll writes snapshot row; error path writes error snapshot; README-hash-unchanged branch doesn't call LLM.
- `test_github_ideator.py` — generates N ideas → N notes in inbox + 1 `repo_idea_runs` row; rate-limiting between runs honored; Ollama fallback on Claude failure.
- `test_repos_route.py` — add/list/get/delete endpoints; 404 on add of unreachable repo; poll-now + ideate-now enqueue jobs.

---

## 13. Compounding Properties

- ✅ **Ideas become notes** via Phase 1 inbox pattern. Notetaker classifies + links → Escalator may auto-research → user may run Roundtable on any idea.
- ✅ **Per-repo notes discoverable.** Every idea-note carries `> From repo: {slug}` in the body; the Notetaker can (optionally, as a follow-up) link the note to a repo-stub article.
- ✅ **Repo stub article (optional).** On first poll, create an `articles` row for the repo (id=`repo-{slug-with-dashes}`, kind='Entity') so note_links can point at it. Future repo-related notes + articles thicken the graph around this stub. (If this is too much for v1, defer — ideas still work without it.)
- ✅ **Historical snapshots enable trend analysis.** The Synthesizer agent could later compare snapshots over time ("this repo doubled stars since last month; here's a synthesis article"). Out of v1 scope.

**Anti-compounding avoided:**
- Repo-tracking isn't a dead-end UI — every repo produces notes that feed all the existing Notes machinery.
- Snapshots aren't a black-hole log — the Poller's `context_md` is the durable, human-readable derivation that Ideator reads.

---

## 14. Implementation Phases

1. **Phase A — Schema + bridge + settings.** Tables, `github_bridge.py`, `GithubSettings`, unit tests for the bridge (mocked httpx).
2. **Phase B — Poller agent + repos API + CLI.** `github_poller.py`, `routes/repos_route.py`, `mastisk add-repo/list-repos/remove-repo`, scheduler registration. Tests mocking the bridge.
3. **Phase C — Ideator agent.** `github_ideator.py`, ideation prompt, idea-to-note writing, `repo_idea_runs` tracking. Tests mocking bridge + LLMs.
4. **Phase D — PWA.** `ReposView`, `RepoDetailView`, `AddRepoModal`, sidebar nav, wire into App. Optional for v1 if CLI + API suffice — user said "add a way" which is satisfied by CLI.
5. **Phase E — README + optional repo stub articles.** Docs + the "create a repo stub article on first poll" compounding nicety.

---

## 15. Open Questions / Known Unknowns

- **PAT scope decision.** The user will need to create a PAT. Should we include a CLI onboarding wizard (`mastisk github-setup`) or just document it? Default: document for v1; wizard is fast-follow.
- **Public-only mode.** Is unauthenticated polling useful? Yes for a user without private repos, but rate limit is tight. v1 supports it; we just log a warning when `pat=""` at first poll.
- **Repo stub articles.** §13 mentions creating an articles row per repo. This is genuinely compounding but touches the articles table in a new way. Defer to Phase E as optional; v1 can ship without it.
- **Ideation cadence tuning.** 24h fixed interval may be too slow for active repos or too fast for stale ones. Future: adaptive cadence based on commit velocity.
- **Cost visibility.** Daily ideation × N repos × Claude calls could add up. v1 tracks idea_runs with model; a per-day cost report is a fast-follow.
- **Conflict with mastisk update rebuilds.** If the user runs `mastisk update` during a poll, the daemon restarts. Poller's `_handle` is a single job so it completes or fails cleanly; no partial state.

These don't block implementation.

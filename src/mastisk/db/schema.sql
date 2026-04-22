-- Mastisk schema. Idempotent via IF NOT EXISTS.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS articles (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,              -- Concept | Entity | Source | Synthesis
  title            TEXT NOT NULL,
  slug             TEXT NOT NULL,
  aka_json         TEXT DEFAULT '[]',
  summary          TEXT,
  body_md          TEXT NOT NULL DEFAULT '',
  confidence       REAL DEFAULT 0.5,
  reading_minutes  INTEGER DEFAULT 3,
  sources_count    INTEGER DEFAULT 0,
  backlinks_count  INTEGER DEFAULT 0,
  forwardlinks_count INTEGER DEFAULT 0,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by       TEXT,
  vault_path       TEXT,
  hero_image_url   TEXT                       -- optional hero picked from the source at ingest time
);

CREATE INDEX IF NOT EXISTS idx_articles_kind ON articles(kind);
CREATE INDEX IF NOT EXISTS idx_articles_updated ON articles(updated_at DESC);

-- External-content FTS5: mirror of `articles`. Rowid in FTS = rowid in articles;
-- we query by joining on rowid rather than carrying id as a column.
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title, summary, body_md,
  content='articles', content_rowid='rowid'
);

CREATE TABLE IF NOT EXISTS article_sections (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  heading    TEXT NOT NULL,
  body       TEXT NOT NULL,
  kind       TEXT DEFAULT 'section',          -- section | callout | open
  PRIMARY KEY (article_id, idx)
);

CREATE TABLE IF NOT EXISTS article_embeddings (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  dim        INTEGER NOT NULL,
  vec        BLOB NOT NULL,                   -- float32 little-endian packed
  computed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  kind          TEXT,                          -- blog | podcast | youtube | paper | rss | twitter
  url           TEXT UNIQUE,
  title         TEXT,
  published_at  DATETIME,
  fetched_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  raw_path      TEXT,                          -- ./data/raw/<hash>.{txt,html,vtt}
  author        TEXT,
  hero_image_url TEXT,                         -- optional thumbnail / cover art captured at ingest
  media_json    TEXT                           -- inline media captured at ingest (JSON array of {src, alt, caption})
);
CREATE INDEX IF NOT EXISTS idx_sources_kind ON sources(kind);

CREATE TABLE IF NOT EXISTS article_sources (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  source_id  TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, source_id)
);

CREATE TABLE IF NOT EXISTS links (
  from_article TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  to_article   TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  weight       REAL DEFAULT 0.5,
  snippet      TEXT,                           -- the line where the link appeared (for backlinks rail)
  PRIMARY KEY (from_article, to_article)
);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_article);

CREATE TABLE IF NOT EXISTS feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP,
  agent TEXT NOT NULL,
  verb TEXT NOT NULL,
  obj  TEXT NOT NULL,
  kind TEXT,
  touched_pages INTEGER DEFAULT 0,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_feed_ts ON feed(ts DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  kind  TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | running | done | failed
  attempts INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  finished_at DATETIME,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_pending ON jobs(agent, status, created_at);

CREATE TABLE IF NOT EXISTS rss_feeds (
  url TEXT PRIMARY KEY,
  title TEXT,
  last_fetched DATETIME,
  last_etag TEXT,
  last_modified TEXT,
  enabled INTEGER DEFAULT 1,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP,
  article_id TEXT REFERENCES articles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                         -- opened | time_read | pinned | unpinned | deleted | edited | asked | skipped
  value_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_signals_article ON signals(article_id);
CREATE INDEX IF NOT EXISTS idx_signals_ts ON signals(ts DESC);

CREATE TABLE IF NOT EXISTS pinned (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  pinned_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  jobs_processed INTEGER DEFAULT 0,
  error TEXT
);

-- Per-article artifacts — charts, comparison cards, timelines, stat panels, etc.
-- Rendered in the article's right rail. spec_json is the declarative spec the
-- frontend consumes (Chart.js config for kind='chart', structured JSON for the
-- others). The generator (artifact-agent) and humans can both write these.
CREATE TABLE IF NOT EXISTS article_artifacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id   TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,      -- 'chart' | 'comparison' | 'timeline' | 'stat'
  title        TEXT NOT NULL,
  description  TEXT,               -- 1-2 sentence narrative that goes next to the viz
  spec_json    TEXT NOT NULL,      -- Chart.js config OR declarative spec for other kinds
  created_by   TEXT,               -- 'compiler' | 'artifact-agent' | 'user'
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_artifacts_article ON article_artifacts(article_id);

-- Linter finding dedup: each structural finding gets a stable hash so the
-- Linter only emits a feed row the first time it sees a condition. Bumping
-- last_seen on subsequent hits lets us age out stale findings without feed
-- spam. resolved_at is set when the condition clears (e.g. an orphan gets
-- a backlink) so we can re-flag if it reappears.
CREATE TABLE IF NOT EXISTS lint_findings (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- 'orphan' | 'empty' | 'dangling' | etc.
  article_id TEXT,
  target TEXT,                     -- for 'dangling', the missing target slug
  first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen  DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_lint_findings_open ON lint_findings(kind) WHERE resolved_at IS NULL;

-- Synthesizer bookkeeping. One row per Draft→Critic pass. cluster_hash is a
-- stable identifier for "these N article ids, in sorted order", so we can
-- skip re-synthesising a cluster whose membership hasn't changed. Scores
-- and rationale come from the Critic model; user_accepted / user_feedback
-- are set later by the accept-or-discard UI layer.
CREATE TABLE IF NOT EXISTS synthesis_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_hash TEXT NOT NULL,
  source_article_ids TEXT NOT NULL,      -- json array
  prompt_version INTEGER NOT NULL DEFAULT 1,
  draft_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  eval_score REAL,                        -- 1.0-5.0
  eval_rationale TEXT,
  user_accepted INTEGER,                  -- null = pending, 1 = accepted, 0 = rejected
  user_feedback TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_synthesis_runs_hash ON synthesis_runs(cluster_hash);
CREATE INDEX IF NOT EXISTS idx_synthesis_runs_pending ON synthesis_runs(user_accepted) WHERE user_accepted IS NULL;

-- Triggers: keep external-content FTS in sync
CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, summary, body_md)
    VALUES (new.rowid, new.title, new.summary, new.body_md);
END;
CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, summary, body_md)
    VALUES ('delete', old.rowid, old.title, old.summary, old.body_md);
END;
CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, summary, body_md)
    VALUES ('delete', old.rowid, old.title, old.summary, old.body_md);
  INSERT INTO articles_fts(rowid, title, summary, body_md)
    VALUES (new.rowid, new.title, new.summary, new.body_md);
END;

-- Trigger: keep *_count columns fresh
CREATE TRIGGER IF NOT EXISTS links_ai AFTER INSERT ON links BEGIN
  UPDATE articles SET backlinks_count = backlinks_count + 1 WHERE id = new.to_article;
  UPDATE articles SET forwardlinks_count = forwardlinks_count + 1 WHERE id = new.from_article;
END;
CREATE TRIGGER IF NOT EXISTS links_ad AFTER DELETE ON links BEGIN
  UPDATE articles SET backlinks_count = MAX(0, backlinks_count - 1) WHERE id = old.to_article;
  UPDATE articles SET forwardlinks_count = MAX(0, forwardlinks_count - 1) WHERE id = old.from_article;
END;
CREATE TRIGGER IF NOT EXISTS article_sources_ai AFTER INSERT ON article_sources BEGIN
  UPDATE articles SET sources_count = sources_count + 1 WHERE id = new.article_id;
END;
CREATE TRIGGER IF NOT EXISTS article_sources_ad AFTER DELETE ON article_sources BEGIN
  UPDATE articles SET sources_count = MAX(0, sources_count - 1) WHERE id = old.article_id;
END;

-- ─────────────────────────────── Notes ───────────────────────────────
-- User-authored content. File in vault/_notes/ is the source of truth;
-- this row is a derived index. See docs/superpowers/specs/2026-04-21-notes-subsystem-design.md

CREATE TABLE IF NOT EXISTS notes (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug                       TEXT UNIQUE NOT NULL,
  path                       TEXT UNIQUE NOT NULL,
  body                       TEXT NOT NULL,
  body_sha256                TEXT NOT NULL,
  source                     TEXT NOT NULL,          -- 'pwa' | 'cli' | 'file'
  created_at                 DATETIME NOT NULL,
  classified_at              DATETIME,
  classification             TEXT,
  summary                    TEXT,
  confidence                 REAL,
  tags_json                  TEXT DEFAULT '[]',
  escalation_state           TEXT NOT NULL DEFAULT 'none',
  escalation_trigger         TEXT,
  escalation_article_id      TEXT REFERENCES articles(id) ON DELETE SET NULL,
  escalation_retry_count     INTEGER NOT NULL DEFAULT 0,
  escalation_next_attempt_at DATETIME,
  deleted_at                 DATETIME
);

CREATE INDEX IF NOT EXISTS idx_notes_created_at         ON notes(created_at);
CREATE INDEX IF NOT EXISTS idx_notes_classified_at      ON notes(classified_at);
CREATE INDEX IF NOT EXISTS idx_notes_escalation_pending ON notes(escalation_state, escalation_next_attempt_at)
  WHERE escalation_state IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_notes_deleted_at         ON notes(deleted_at);

CREATE TABLE IF NOT EXISTS note_links (
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  article_id TEXT    NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  rank       INTEGER NOT NULL,
  PRIMARY KEY (note_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_note_links_article ON note_links(article_id);

CREATE TABLE IF NOT EXISTS note_escalations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id         INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  triggered_at    DATETIME NOT NULL,
  trigger         TEXT NOT NULL,
  result          TEXT NOT NULL,
  stub_article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  error           TEXT,
  model           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_note_escalations_note         ON note_escalations(note_id);
CREATE INDEX IF NOT EXISTS idx_note_escalations_triggered_at ON note_escalations(triggered_at);

-- ─────────────────────────────── Roundtables ───────────────────────────────
-- A roundtable is one fan-out of a prompt to multiple LLMs + one synthesis.
-- Fully DB-stored (no filesystem artifact), because perspectives are transient
-- research output, not canonical user content.
-- See docs/superpowers/specs/2026-04-22-multi-llm-roundtable-design.md §5

CREATE TABLE IF NOT EXISTS roundtables (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  input_type       TEXT NOT NULL,       -- 'note' | 'article' | 'prompt'
  input_ref        TEXT NOT NULL,       -- stringified note_id | article_id | '' for free prompt
  prompt           TEXT NOT NULL,       -- the final prompt used
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  synthesis        TEXT,
  synthesis_model  TEXT,
  error            TEXT,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at      DATETIME,
  saved_as_note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_roundtables_created ON roundtables(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_roundtables_status  ON roundtables(status) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_roundtables_input   ON roundtables(input_type, input_ref);

CREATE TABLE IF NOT EXISTS roundtable_perspectives (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  roundtable_id INTEGER NOT NULL REFERENCES roundtables(id) ON DELETE CASCADE,
  backend       TEXT NOT NULL,         -- 'claude' | 'codex' | 'gemini' | 'ollama'
  model         TEXT,
  content       TEXT,
  error         TEXT,
  latency_ms    INTEGER,
  started_at    DATETIME,
  finished_at   DATETIME
);

CREATE INDEX IF NOT EXISTS idx_roundtable_perspectives_rt ON roundtable_perspectives(roundtable_id);

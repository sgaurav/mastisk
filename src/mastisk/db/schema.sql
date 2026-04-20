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
  vault_path       TEXT
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
  author        TEXT
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

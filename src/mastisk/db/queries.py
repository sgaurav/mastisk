"""Database access — small, direct, no ORM.

Sync (sqlite3) for most reads; async helpers used only where FastAPI routes really need to yield.
Mastisk is single-user; a single sqlite3 connection with WAL is fine.
"""
from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from mastisk.paths import db_path

_SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def connect(path: Path | None = None) -> sqlite3.Connection:
    p = path or db_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_schema(conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    c = conn or connect()
    try:
        c.executescript(_SCHEMA_PATH.read_text())
    finally:
        if own:
            c.close()


@contextmanager
def txn(conn: sqlite3.Connection):
    conn.execute("BEGIN")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


# ─────────────────────────────── Articles ───────────────────────────────

def list_articles(
    conn: sqlite3.Connection,
    *,
    kind: str | None = None,
    limit: int = 200,
) -> list[dict]:
    q = "SELECT * FROM articles"
    params: list[Any] = []
    if kind:
        q += " WHERE kind = ?"
        params.append(kind)
    q += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)
    return [dict(r) for r in conn.execute(q, params)]


def get_article(conn: sqlite3.Connection, article_id: str) -> dict | None:
    row = conn.execute("SELECT * FROM articles WHERE id = ?", (article_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["aka"] = json.loads(d.pop("aka_json") or "[]")
    d["sections"] = [
        dict(r)
        for r in conn.execute(
            "SELECT idx, heading AS h, body, kind FROM article_sections WHERE article_id = ? ORDER BY idx",
            (article_id,),
        )
    ]
    d["related"] = [
        {"id": r["to_article"], "label": r["title"], "weight": r["weight"]}
        for r in conn.execute(
            """SELECT links.to_article, links.weight, articles.title
               FROM links JOIN articles ON articles.id = links.to_article
               WHERE links.from_article = ?
               ORDER BY links.weight DESC LIMIT 20""",
            (article_id,),
        )
    ]
    d["sourceList"] = [
        dict(r)
        for r in conn.execute(
            """SELECT sources.kind, sources.title, sources.published_at AS date
               FROM article_sources JOIN sources ON sources.id = article_sources.source_id
               WHERE article_sources.article_id = ?""",
            (article_id,),
        )
    ]
    # camelCase a couple for the frontend
    d["readingTime"] = f"{d.pop('reading_minutes', 3)} min"
    d["sources"] = d.pop("sources_count", 0)
    d["backlinks"] = d.pop("backlinks_count", 0)
    d["forwardlinks"] = d.pop("forwardlinks_count", 0)
    return d


def upsert_article(conn: sqlite3.Connection, art: dict) -> None:
    conn.execute(
        """INSERT INTO articles (id, kind, title, slug, aka_json, summary, body_md,
                                 confidence, reading_minutes, updated_by, vault_path)
           VALUES (:id, :kind, :title, :slug, :aka_json, :summary, :body_md,
                   :confidence, :reading_minutes, :updated_by, :vault_path)
           ON CONFLICT(id) DO UPDATE SET
             kind=excluded.kind, title=excluded.title, slug=excluded.slug,
             aka_json=excluded.aka_json, summary=excluded.summary, body_md=excluded.body_md,
             confidence=excluded.confidence, reading_minutes=excluded.reading_minutes,
             updated_by=excluded.updated_by, vault_path=excluded.vault_path,
             updated_at=CURRENT_TIMESTAMP""",
        {
            "id": art["id"],
            "kind": art["kind"],
            "title": art["title"],
            "slug": art.get("slug", art["id"]),
            "aka_json": json.dumps(art.get("aka", [])),
            "summary": art.get("summary", ""),
            "body_md": art.get("body_md", ""),
            "confidence": art.get("confidence", 0.5),
            "reading_minutes": art.get("reading_minutes", 3),
            "updated_by": art.get("updated_by"),
            "vault_path": art.get("vault_path"),
        },
    )


def replace_sections(conn: sqlite3.Connection, article_id: str, sections: Iterable[dict]) -> None:
    conn.execute("DELETE FROM article_sections WHERE article_id = ?", (article_id,))
    for i, s in enumerate(sections):
        conn.execute(
            "INSERT INTO article_sections (article_id, idx, heading, body, kind) VALUES (?, ?, ?, ?, ?)",
            (article_id, i, s.get("h") or s.get("heading", ""), s.get("body", ""), s.get("kind", "section")),
        )


def set_related(conn: sqlite3.Connection, article_id: str, links: Iterable[dict]) -> None:
    """Replace outgoing links for an article.

    Silently drops link targets that don't exist yet — the Compiler often
    references sibling articles that haven't been written on this pass. A
    scheduled backfill reconciles these once the graph catches up.
    """
    conn.execute("DELETE FROM links WHERE from_article = ?", (article_id,))
    for r in links:
        target = r.get("id")
        if not target or target == article_id:
            continue
        exists = conn.execute("SELECT 1 FROM articles WHERE id = ?", (target,)).fetchone()
        if not exists:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO links (from_article, to_article, weight, snippet) VALUES (?, ?, ?, ?)",
            (article_id, target, r.get("weight", 0.5), r.get("snippet")),
        )


# ─────────────────────────────── Vault / sidebar ───────────────────────────────

def vault_tree(conn: sqlite3.Connection) -> list[dict]:
    """Return the sidebar vault tree — mirrors the shape the React shell expects."""
    def folder(label: str, kind: str, glyph: str, *, hot_ids: set[str] = frozenset()) -> dict:
        rows = [
            {
                "kind": "page",
                "id": r["id"],
                "label": r["title"],
                "glyph": glyph,
                "hot": r["id"] in hot_ids,
            }
            for r in conn.execute(
                "SELECT id, title FROM articles WHERE kind = ? ORDER BY updated_at DESC LIMIT 50",
                (kind,),
            )
        ]
        count = conn.execute("SELECT COUNT(*) AS n FROM articles WHERE kind = ?", (kind,)).fetchone()["n"]
        return {"kind": "folder", "label": label, "count": count, "children": rows}

    # "Hot" = >1 signal in last 3 days
    hot = {
        r["article_id"]
        for r in conn.execute(
            "SELECT article_id FROM signals WHERE ts >= datetime('now', '-3 days') GROUP BY article_id HAVING COUNT(*) > 1"
        )
    }

    def badge_if_nonzero(n: int) -> str | None:
        return str(n) if n > 0 else None

    digest_n = conn.execute(
        "SELECT COUNT(*) AS n FROM articles WHERE DATE(updated_at) = DATE('now')"
    ).fetchone()["n"]
    queue_n = conn.execute("SELECT COUNT(*) AS n FROM jobs WHERE status='queued'").fetchone()["n"]
    any_feed = conn.execute("SELECT 1 FROM feed LIMIT 1").fetchone() is not None

    return [
        {"kind": "section", "label": "Today"},
        {"kind": "page", "id": "digest", "label": "Daily Digest", "glyph": "◐", "badge": badge_if_nonzero(digest_n)},
        {"kind": "page", "id": "queue", "label": "Reading queue", "glyph": "≡", "badge": badge_if_nonzero(queue_n)},
        {"kind": "page", "id": "feed", "label": "Agent feed", "glyph": "◇", "badge": "live" if any_feed else None},
        {"kind": "section", "label": "Wiki"},
        folder("Concepts", "Concept", "▲", hot_ids=hot),
        folder("Entities", "Entity", "●"),
        folder("Sources", "Source", "◊"),
        folder("Synthesis", "Synthesis", "✦"),
        {"kind": "section", "label": "System"},
        {"kind": "page", "id": "graph", "label": "Graph view", "glyph": "✱"},
        {"kind": "page", "id": "agents", "label": "Agents", "glyph": "◯"},
        {"kind": "page", "id": "ingest", "label": "Sources & ingest", "glyph": "↧"},
        {"kind": "page", "id": "lint", "label": "System health", "glyph": "✓"},
        {"kind": "page", "id": "settings", "label": "Settings", "glyph": "⚙"},
    ]


def user_info(conn: sqlite3.Connection) -> dict:
    """Pull a personalized label from identity.md + live counts for the sidebar pill."""
    import getpass, re
    from mastisk.paths import self_dir

    # Name: prefer first bullet under `## Role` in identity.md, else OS user, else "You".
    name = (getpass.getuser() or "you").capitalize()
    p = self_dir() / "identity.md"
    if p.exists():
        text = p.read_text()
        m = re.search(r"^##\s*Role\s*\n([^\n]*\n){0,8}", text, flags=re.M)
        if m:
            for line in m.group(0).splitlines()[1:]:
                line = line.strip()
                if not line or line.startswith("#") or line.startswith("("):
                    continue
                # "- Sushil — engineer..." → "Sushil"
                cleaned = re.sub(r"^[-*•\d.\s]+", "", line).strip()
                cleaned = re.split(r"[—\-–|,]", cleaned, maxsplit=1)[0].strip()
                cleaned = re.sub(r"\*\*", "", cleaned)
                if cleaned and len(cleaned) < 40:
                    name = cleaned
                    break

    pages   = conn.execute("SELECT COUNT(*) AS n FROM articles").fetchone()["n"]
    sources = conn.execute("SELECT COUNT(*) AS n FROM sources").fetchone()["n"]
    feeds   = conn.execute("SELECT COUNT(*) AS n FROM rss_feeds WHERE enabled=1").fetchone()["n"]

    initials = "".join(w[0] for w in name.split()[:2]).upper() or "—"

    return {
        "name": name,
        "initials": initials,
        "stats": {"pages": pages, "sources": sources, "feeds": feeds},
    }


def pinned_list(conn: sqlite3.Connection) -> list[dict]:
    return [
        {"id": r["id"], "label": r["title"]}
        for r in conn.execute(
            """SELECT articles.id, articles.title
               FROM pinned JOIN articles ON articles.id = pinned.article_id
               ORDER BY pinned.pinned_at DESC LIMIT 10"""
        )
    ]


# ─────────────────────────────── Feed / signals ───────────────────────────────

def append_feed(
    conn: sqlite3.Connection, *, agent: str, verb: str, obj: str,
    kind: str | None = None, touched_pages: int = 0, payload: dict | None = None,
) -> int:
    cur = conn.execute(
        "INSERT INTO feed (agent, verb, obj, kind, touched_pages, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
        (agent, verb, obj, kind, touched_pages, json.dumps(payload) if payload else None),
    )
    return cur.lastrowid or 0


def recent_feed(conn: sqlite3.Connection, *, limit: int = 50) -> list[dict]:
    rows = [dict(r) for r in conn.execute("SELECT * FROM feed ORDER BY ts DESC LIMIT ?", (limit,))]
    return [_feed_row_for_ui(r) for r in rows]


def _feed_row_for_ui(r: dict) -> dict:
    ts = datetime.fromisoformat(r["ts"]) if isinstance(r["ts"], str) else r["ts"]
    delta = datetime.utcnow() - ts
    if delta.total_seconds() < 60:
        t = f"{int(delta.total_seconds())}s"
    elif delta.total_seconds() < 3600:
        t = f"{int(delta.total_seconds() / 60)}m"
    elif delta.total_seconds() < 86400:
        t = f"{int(delta.total_seconds() / 3600)}h"
    else:
        t = f"{int(delta.total_seconds() / 86400)}d"
    return {"t": t, "agent": r["agent"], "verb": r["verb"], "obj": r["obj"], "touched": r["touched_pages"] or 0}


def add_signal(
    conn: sqlite3.Connection, *, article_id: str | None, kind: str, value: dict | None = None
) -> None:
    conn.execute(
        "INSERT INTO signals (article_id, kind, value_json) VALUES (?, ?, ?)",
        (article_id, kind, json.dumps(value) if value else None),
    )


def pin_article(conn: sqlite3.Connection, article_id: str) -> None:
    conn.execute("INSERT OR IGNORE INTO pinned (article_id) VALUES (?)", (article_id,))


def unpin_article(conn: sqlite3.Connection, article_id: str) -> None:
    conn.execute("DELETE FROM pinned WHERE article_id = ?", (article_id,))


# ─────────────────────────────── Search ───────────────────────────────

def search_articles(conn: sqlite3.Connection, q: str, *, limit: int = 20) -> list[dict]:
    if not q.strip():
        return []
    # External-content FTS: join on rowid
    rows = conn.execute(
        """SELECT articles.id, articles.title, articles.kind, articles.summary,
                  snippet(articles_fts, 2, '<mark>', '</mark>', '…', 10) AS snippet
           FROM articles_fts JOIN articles ON articles.rowid = articles_fts.rowid
           WHERE articles_fts MATCH ? ORDER BY rank LIMIT ?""",
        (_fts_escape(q), limit),
    )
    return [dict(r) for r in rows]


_STOPWORDS = frozenset("""
a an and are as at be but by do does for from how i if in is it its of on
or that the their them then there they this to was were what when where
which who why will with you your me my our us me what's that's there's
""".split())


def _fts_escape(q: str) -> str:
    """Build an FTS5 MATCH expression with OR semantics, stopwords stripped.

    We want "What is test-time compute and why does it matter?" to match any article
    containing the meaningful terms — not require every word, including stopwords.
    """
    import re
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9\-]+", q)
    terms = [t for t in tokens if t.lower() not in _STOPWORDS and len(t) > 1]
    if not terms:
        return f'"{q.strip()}"' if q.strip() else "NULL"
    # Quote each term, OR-join. FTS5 is case-insensitive.
    return " OR ".join(f'"{t}"' for t in terms)

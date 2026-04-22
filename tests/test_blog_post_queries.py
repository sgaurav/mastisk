"""Query helpers for blog_posts / blog_post_sources.

See src/mastisk/db/queries.py blog-posts section + spec §§10-13.
"""
from __future__ import annotations

import time


def test_create_blog_post_defaults(db):
    from mastisk.db.queries import create_blog_post, get_blog_post

    bp_id = create_blog_post(db, theme="test-time compute", window_days=14)
    assert isinstance(bp_id, int) and bp_id > 0

    row = get_blog_post(db, bp_id)
    assert row is not None
    assert row["theme"] == "test-time compute"
    assert row["window_days"] == 14
    assert row["status"] == "pending"
    # slug/path/title are all nullable pre-done.
    assert row["slug"] is None
    assert row["path"] is None
    assert row["title"] is None
    assert row["finished_at"] is None
    assert row["deleted_at"] is None


def test_get_blog_post_missing_returns_none(db):
    from mastisk.db.queries import get_blog_post

    assert get_blog_post(db, 99999) is None


def test_list_blog_posts_newest_first_excludes_deleted(db):
    from mastisk.db.queries import (
        create_blog_post,
        list_blog_posts,
        soft_delete_blog_post,
    )

    ids = [
        create_blog_post(db, theme=f"t{i}", window_days=14) for i in range(3)
    ]
    # Tombstone the middle one.
    soft_delete_blog_post(db, ids[1])

    rows = list_blog_posts(db, limit=10)
    returned = [r["id"] for r in rows]
    assert ids[1] not in returned
    # Newest first — ids[2] before ids[0].
    assert returned == [ids[2], ids[0]]


def test_list_blog_posts_pagination(db):
    from mastisk.db.queries import create_blog_post, list_blog_posts

    ids = [
        create_blog_post(db, theme=f"t{i}", window_days=14) for i in range(5)
    ]
    rows = list_blog_posts(db, limit=10, before_id=ids[3])
    returned = [r["id"] for r in rows]
    assert ids[3] not in returned
    for rid in returned:
        assert rid < ids[3]


def test_update_blog_post_status_running(db):
    """Compact form — just flips status, no finished_at."""
    from mastisk.db.queries import create_blog_post, update_blog_post_status

    bp_id = create_blog_post(db, theme="t", window_days=14)
    update_blog_post_status(db, bp_id=bp_id, status="running")
    row = db.execute(
        "SELECT status, finished_at, error FROM blog_posts WHERE id=?", (bp_id,),
    ).fetchone()
    assert row["status"] == "running"
    assert row["finished_at"] is None
    assert row["error"] is None


def test_update_blog_post_status_failed(db):
    """finished=True stamps finished_at + writes error."""
    from mastisk.db.queries import create_blog_post, update_blog_post_status

    bp_id = create_blog_post(db, theme="t", window_days=14)
    update_blog_post_status(
        db, bp_id=bp_id, status="failed", error="no sources", finished=True,
    )
    row = db.execute(
        "SELECT status, error, finished_at FROM blog_posts WHERE id=?", (bp_id,),
    ).fetchone()
    assert row["status"] == "failed"
    assert row["error"] == "no sources"
    assert row["finished_at"] is not None


def test_update_blog_post_done_writes_all_fields(db):
    """update_blog_post_done flips status + writes slug/path/title/etc."""
    from mastisk.db.queries import create_blog_post, update_blog_post_done

    bp_id = create_blog_post(db, theme="t", window_days=14)
    update_blog_post_done(
        db, bp_id=bp_id, slug="2026-04-22-the-draft",
        path="blog/drafts/2026-04-22-the-draft.md",
        title="The draft", tags_json='["a","b"]', model="claude",
        word_count=1200, body_preview="preamble…",
    )
    row = db.execute("SELECT * FROM blog_posts WHERE id=?", (bp_id,)).fetchone()
    assert row["status"] == "done"
    assert row["slug"] == "2026-04-22-the-draft"
    assert row["path"] == "blog/drafts/2026-04-22-the-draft.md"
    assert row["title"] == "The draft"
    assert row["tags_json"] == '["a","b"]'
    assert row["model"] == "claude"
    assert row["word_count"] == 1200
    assert row["body_preview"] == "preamble…"
    assert row["finished_at"] is not None


def test_soft_delete_blog_post_sets_deleted_at(db):
    from mastisk.db.queries import create_blog_post, soft_delete_blog_post

    bp_id = create_blog_post(db, theme="t", window_days=14)
    soft_delete_blog_post(db, bp_id)
    row = db.execute(
        "SELECT deleted_at, status FROM blog_posts WHERE id=?", (bp_id,),
    ).fetchone()
    assert row["deleted_at"] is not None
    # Status is orthogonal — we don't touch it on delete. Spec §7.
    assert row["status"] == "pending"


def test_soft_delete_blog_post_cascades_sources(db):
    """ON DELETE CASCADE on blog_post_sources should clear rows when the
    parent row is *actually* deleted. Our soft_delete sets deleted_at — it
    doesn't row-delete — so sources survive. This documents the behavior:
    the route layer explicitly calls delete_blog_post_sources on regenerate;
    the full-row-delete path isn't used.
    """
    from mastisk.db.queries import (
        create_blog_post,
        insert_blog_post_source,
        list_blog_post_sources,
        soft_delete_blog_post,
    )

    bp_id = create_blog_post(db, theme="t", window_days=14)
    insert_blog_post_source(
        db, blog_post_id=bp_id, kind="note", ref="1", rank=1, used=True,
    )
    soft_delete_blog_post(db, bp_id)
    # Sources still there — soft delete, not hard delete.
    rows = list_blog_post_sources(db, bp_id)
    assert len(rows) == 1


def test_insert_and_list_blog_post_sources(db):
    from mastisk.db.queries import (
        create_blog_post,
        insert_blog_post_source,
        list_blog_post_sources,
    )

    bp_id = create_blog_post(db, theme="t", window_days=14)
    insert_blog_post_source(
        db, blog_post_id=bp_id, kind="note", ref="5",
        rank=2, used=True, origin="repo_ideator",
    )
    insert_blog_post_source(
        db, blog_post_id=bp_id, kind="article", ref="foo-slug",
        rank=1, used=False,
    )
    rows = list_blog_post_sources(db, bp_id)
    # Ordered by rank ASC.
    assert [r["rank"] for r in rows] == [1, 2]
    assert rows[0]["kind"] == "article"
    assert rows[0]["used"] == 0
    assert rows[1]["kind"] == "note"
    assert rows[1]["origin"] == "repo_ideator"
    assert rows[1]["used"] == 1


def test_delete_blog_post_sources(db):
    from mastisk.db.queries import (
        create_blog_post,
        delete_blog_post_sources,
        insert_blog_post_source,
        list_blog_post_sources,
    )

    bp_id = create_blog_post(db, theme="t", window_days=14)
    for i in range(3):
        insert_blog_post_source(
            db, blog_post_id=bp_id, kind="note", ref=str(i + 1),
            rank=i + 1, used=False,
        )
    n = delete_blog_post_sources(db, bp_id)
    assert n == 3
    assert list_blog_post_sources(db, bp_id) == []


def test_reset_blog_post_for_regenerate(db):
    from mastisk.db.queries import (
        create_blog_post,
        reset_blog_post_for_regenerate,
        update_blog_post_done,
    )

    bp_id = create_blog_post(db, theme="t", window_days=14)
    update_blog_post_done(
        db, bp_id=bp_id, slug="s", path="p", title="T",
        tags_json='["a"]', model="claude", word_count=1000,
        body_preview="pre",
    )
    reset_blog_post_for_regenerate(db, bp_id)
    row = db.execute("SELECT * FROM blog_posts WHERE id=?", (bp_id,)).fetchone()
    assert row["status"] == "pending"
    # slug and path are INTENTIONALLY preserved so the BlogWriter agent can
    # unlink the prior draft file on the regenerate run (see
    # reset_blog_post_for_regenerate docstring). update_blog_post_done on
    # the next successful run overwrites them.
    assert row["slug"] == "s"
    assert row["path"] == "p"
    assert row["title"] is None
    assert row["model"] is None
    assert row["word_count"] is None
    assert row["body_preview"] is None
    assert row["finished_at"] is None
    assert row["error"] is None
    # Theme + window_days are preserved — regenerate uses them.
    assert row["theme"] == "t"
    assert row["window_days"] == 14


def test_reclaim_running_blog_posts_flips_stale_rows(db):
    """Rows in 'running' older than stale_minutes → 'failed'."""
    from mastisk.db.queries import create_blog_post, reclaim_running_blog_posts

    bp_id = create_blog_post(db, theme="t", window_days=14)
    # Force the row into 'running' with an old created_at.
    db.execute(
        "UPDATE blog_posts SET status='running', created_at=datetime('now','-2 hours') WHERE id=?",
        (bp_id,),
    )
    n = reclaim_running_blog_posts(db, stale_minutes=60)
    assert n == 1
    row = db.execute("SELECT * FROM blog_posts WHERE id=?", (bp_id,)).fetchone()
    assert row["status"] == "failed"
    assert row["error"] == "daemon restart during draft"
    assert row["finished_at"] is not None


def test_reclaim_running_blog_posts_skips_fresh_rows(db):
    """A row in 'running' that started seconds ago shouldn't be reclaimed."""
    from mastisk.db.queries import create_blog_post, reclaim_running_blog_posts

    bp_id = create_blog_post(db, theme="t", window_days=14)
    db.execute(
        "UPDATE blog_posts SET status='running' WHERE id=?", (bp_id,),
    )
    # stale_minutes=60; row created seconds ago → no reclaim.
    n = reclaim_running_blog_posts(db, stale_minutes=60)
    assert n == 0
    row = db.execute("SELECT status FROM blog_posts WHERE id=?", (bp_id,)).fetchone()
    assert row["status"] == "running"


def test_list_blog_posts_parses_created_at_for_sort_when_same_second(db):
    """Ties in created_at resolve via id DESC (newest first)."""
    from mastisk.db.queries import create_blog_post, list_blog_posts

    # Insert a few rows back-to-back; they share the same second.
    ids = [create_blog_post(db, theme=f"t{i}", window_days=14) for i in range(3)]
    time.sleep(0.01)  # harmless; CURRENT_TIMESTAMP is second-resolution
    rows = list_blog_posts(db, limit=10)
    returned = [r["id"] for r in rows]
    assert returned == list(reversed(ids))

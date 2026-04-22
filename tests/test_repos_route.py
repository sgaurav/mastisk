from __future__ import annotations

from unittest.mock import AsyncMock, patch
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(vault_tmp, data_tmp, db):
    from mastisk.settings import reload_settings
    reload_settings()
    from mastisk.app import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c


def _fake_meta(owner, name):
    return {
        "slug": f"{owner}/{name}", "owner": owner, "name": name,
        "display_name": f"{owner}/{name}", "description": "d",
        "default_branch": "main", "is_private": 0,
        "stars_count": 10, "forks_count": 2,
    }


def test_add_repo(client, db):
    async def fake_meta(o, n): return _fake_meta(o, n)
    with patch("mastisk.routes.repos_route.github_bridge.fetch_repo_metadata", side_effect=fake_meta):
        r = client.post("/api/repos", json={"slug": "Anthropics/claude-code"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["slug"] == "anthropics/claude-code"
    # DB row
    row = db.execute("SELECT * FROM repos WHERE slug='anthropics/claude-code'").fetchone()
    assert row is not None
    # Poll job enqueued
    jrow = db.execute("SELECT 1 FROM jobs WHERE agent='github_poller'").fetchone()
    assert jrow is not None


def test_add_repo_404_for_unknown(client):
    from mastisk.bridges import github_bridge
    async def raise_nf(o, n): raise github_bridge.GithubNotFound("nope")
    with patch("mastisk.routes.repos_route.github_bridge.fetch_repo_metadata", side_effect=raise_nf):
        r = client.post("/api/repos", json={"slug": "nope/nope"})
    assert r.status_code == 404


def test_add_repo_422_for_bad_slug(client):
    r = client.post("/api/repos", json={"slug": "no-slash"})
    assert r.status_code == 422


def test_list_repos_empty(client):
    r = client.get("/api/repos")
    assert r.status_code == 200
    assert r.json() == []


def test_list_repos_with_one(client, db):
    db.execute("INSERT INTO repos (slug, owner, name, display_name) VALUES ('a/b', 'a', 'b', 'a/b')")
    r = client.get("/api/repos")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["slug"] == "a/b"


def test_get_repo_detail(client, db):
    db.execute("INSERT INTO repos (slug, owner, name, display_name, description, context_md) VALUES ('a/b', 'a', 'b', 'a/b', 'd', '# ctx')")
    r = client.get("/api/repos/a/b")
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "a/b"
    assert body["context_md"] == "# ctx"


def test_delete_repo(client, db):
    db.execute("INSERT INTO repos (slug, owner, name) VALUES ('a/b', 'a', 'b')")
    r = client.delete("/api/repos/a/b")
    assert r.status_code == 204
    row = db.execute("SELECT deleted_at FROM repos WHERE slug='a/b'").fetchone()
    assert row["deleted_at"] is not None


def test_poll_now_enqueues(client, db):
    db.execute("INSERT INTO repos (slug, owner, name) VALUES ('a/b', 'a', 'b')")
    r = client.post("/api/repos/a/b/poll-now")
    assert r.status_code == 202
    jrow = db.execute("SELECT 1 FROM jobs WHERE agent='github_poller'").fetchone()
    assert jrow is not None

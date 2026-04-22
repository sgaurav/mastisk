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


def test_ideate_now_enqueues(client, db):
    db.execute("INSERT INTO repos (slug, owner, name) VALUES ('a/b', 'a', 'b')")
    r = client.post("/api/repos/a/b/ideate-now")
    assert r.status_code == 202
    jrow = db.execute("SELECT 1 FROM jobs WHERE agent='github_ideator'").fetchone()
    assert jrow is not None


def test_ideate_now_404_on_unknown(client):
    r = client.post("/api/repos/gone/gone/ideate-now")
    assert r.status_code == 404


def test_add_repo_404_message_varies_by_pat_config(client, monkeypatch):
    """When no PAT is configured, the 404 hints about private repos."""
    from mastisk.bridges import github_bridge
    async def raise_nf(o, n): raise github_bridge.GithubNotFound("nope")
    with patch("mastisk.routes.repos_route.github_bridge.fetch_repo_metadata", side_effect=raise_nf):
        # Ensure no PAT
        monkeypatch.setenv("MASTISK_GITHUB_PAT", "")
        # Reload settings so the empty PAT takes effect (note: pydantic-settings caches;
        # reload_settings() clears the lru_cache)
        from mastisk.settings import reload_settings
        reload_settings()
        r = client.post("/api/repos", json={"slug": "nope/nope"})
    assert r.status_code == 404
    # Message must suggest PAT when none is set
    assert "PAT" in r.json()["detail"]


def test_add_repo_404_message_with_pat(client, monkeypatch):
    """When a PAT is configured, the 404 implies the PAT may lack access."""
    from mastisk.bridges import github_bridge
    async def raise_nf(o, n): raise github_bridge.GithubNotFound("nope")
    monkeypatch.setenv("MASTISK_GITHUB_PAT", "ghp_fake_for_test")
    # pydantic-settings may or may not read this env; if not, patch settings directly:
    from mastisk.settings import get_settings
    from unittest.mock import patch as _patch
    s = get_settings()
    with _patch.object(s.github, "pat", "ghp_fake_for_test"):
        with patch("mastisk.routes.repos_route.github_bridge.fetch_repo_metadata", side_effect=raise_nf):
            r = client.post("/api/repos", json={"slug": "nope/nope"})
    assert r.status_code == 404
    # Should mention "doesn't have access" or similar, not "add a PAT"
    body = r.json()["detail"]
    assert "access" in body or "doesn't have" in body


def test_add_local_repo_endpoint(client, db, tmp_path):
    import subprocess
    p = tmp_path / "myproj"
    p.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=p, check=True)
    (p / "README.md").write_text("# x")
    subprocess.run(["git", "-c", "user.email=x@x.x", "-c", "user.name=x", "add", "."], cwd=p, check=True)
    subprocess.run(["git", "-c", "user.email=x@x.x", "-c", "user.name=x", "commit", "-q", "-m", "i"], cwd=p, check=True)

    r = client.post("/api/repos/local", json={"path": str(p)})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["slug"].startswith("local:")
    assert body["local_path"] == str(p.resolve())

    # DB row + poll job
    assert db.execute("SELECT 1 FROM repos WHERE slug = ?", (body["slug"],)).fetchone()
    assert db.execute("SELECT 1 FROM jobs WHERE agent='github_poller'").fetchone()


def test_add_local_repo_rejects_non_git_dir(client, tmp_path):
    # Directory exists but no .git
    (tmp_path / "plain").mkdir()
    r = client.post("/api/repos/local", json={"path": str(tmp_path / "plain")})
    assert r.status_code == 422
    assert "not a git repo" in r.json()["detail"]


def test_add_local_repo_rejects_missing_dir(client, tmp_path):
    r = client.post("/api/repos/local", json={"path": str(tmp_path / "nope")})
    assert r.status_code == 422


def test_get_repo_by_slug_github(client, db):
    db.execute(
        "INSERT INTO repos (slug, source_type, owner, name, display_name) "
        "VALUES ('a/b', 'github', 'a', 'b', 'a/b')"
    )
    # `{slug:path}` accepts the slash directly
    r = client.get("/api/repos/by-slug/a/b")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["slug"] == "a/b"
    assert body["source_type"] == "github"


def test_get_repo_by_slug_local(client, db, tmp_path):
    slug = f"local:{tmp_path.resolve()}"
    db.execute(
        """INSERT INTO repos (slug, source_type, owner, name, display_name, local_path)
           VALUES (?, 'local', 'local', 'tmp', 'local:tmp', ?)""",
        (slug, str(tmp_path)),
    )
    r = client.get(f"/api/repos/by-slug/{slug}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["slug"] == slug
    assert body["source_type"] == "local"
    assert body["local_path"] == str(tmp_path)


def test_delete_repo_by_slug(client, db, tmp_path):
    slug = f"local:{tmp_path.resolve()}"
    db.execute(
        """INSERT INTO repos (slug, source_type, owner, name, display_name, local_path)
           VALUES (?, 'local', 'local', 'tmp', 'local:tmp', ?)""",
        (slug, str(tmp_path)),
    )
    r = client.delete(f"/api/repos/by-slug/{slug}")
    assert r.status_code == 204
    row = db.execute("SELECT deleted_at FROM repos WHERE slug = ?", (slug,)).fetchone()
    assert row["deleted_at"] is not None


def test_poll_by_slug_enqueues(client, db, tmp_path):
    slug = f"local:{tmp_path.resolve()}"
    db.execute(
        """INSERT INTO repos (slug, source_type, owner, name, display_name, local_path)
           VALUES (?, 'local', 'local', 'tmp', 'local:tmp', ?)""",
        (slug, str(tmp_path)),
    )
    r = client.post(f"/api/repos/poll/{slug}")
    assert r.status_code == 202, r.text
    assert db.execute("SELECT 1 FROM jobs WHERE agent='github_poller'").fetchone()


def test_ideate_by_slug_enqueues(client, db, tmp_path):
    slug = f"local:{tmp_path.resolve()}"
    db.execute(
        """INSERT INTO repos (slug, source_type, owner, name, display_name, local_path)
           VALUES (?, 'local', 'local', 'tmp', 'local:tmp', ?)""",
        (slug, str(tmp_path)),
    )
    r = client.post(f"/api/repos/ideate/{slug}")
    assert r.status_code == 202, r.text
    assert db.execute("SELECT 1 FROM jobs WHERE agent='github_ideator'").fetchone()

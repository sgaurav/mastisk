"""Integration tests for /api/notes routes."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(vault_tmp, data_tmp, db):
    """Build the FastAPI app with tmp paths in effect. `db` runs first so schema is applied."""
    from mastisk.settings import reload_settings
    reload_settings()
    from mastisk.app import create_app
    app = create_app()
    with TestClient(app) as c:
        yield c


def test_post_notes_creates_file_and_row(client, vault_tmp):
    r = client.post("/api/notes", json={"text": "first thought", "source": "pwa"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] > 0
    assert body["slug"].endswith("first-thought") or "first" in body["slug"]
    file_path = vault_tmp / body["path"]
    assert file_path.exists()
    assert "first thought" in file_path.read_text()


def test_post_notes_rejects_empty_text(client):
    r = client.post("/api/notes", json={"text": "   ", "source": "pwa"})
    assert r.status_code == 422


def test_post_notes_uses_cli_source(client):
    r = client.post("/api/notes", json={"text": "from cli", "source": "cli"})
    assert r.status_code == 201
    note_id = r.json()["id"]
    from mastisk.db.queries import connect, get_note
    with connect() as conn:
        row = get_note(conn, note_id)
        assert row["source"] == "cli"


def test_list_notes_returns_most_recent_first(client):
    for i in range(3):
        client.post("/api/notes", json={"text": f"thought {i}"})
    r = client.get("/api/notes")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 3
    assert rows[0]["id"] > rows[1]["id"] > rows[2]["id"]


def test_list_notes_limit_param(client):
    for i in range(5):
        client.post("/api/notes", json={"text": f"thought {i}"})
    r = client.get("/api/notes?limit=2")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_get_note_detail(client):
    post = client.post("/api/notes", json={"text": "detailed thought"}).json()
    r = client.get(f"/api/notes/{post['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == post["id"]
    assert body["body"] == "detailed thought"
    assert body["classification"] is None
    assert body["source"] == "pwa"


def test_get_note_404_on_unknown(client):
    r = client.get("/api/notes/99999")
    assert r.status_code == 404


def test_delete_note_tombstones_and_removes_file(client, vault_tmp):
    post = client.post("/api/notes", json={"text": "to delete"}).json()
    file_path = vault_tmp / post["path"]
    assert file_path.exists()

    r = client.delete(f"/api/notes/{post['id']}")
    assert r.status_code == 204
    assert not file_path.exists()
    listing = client.get("/api/notes").json()
    assert all(n["id"] != post["id"] for n in listing)


def test_delete_idempotent(client):
    post = client.post("/api/notes", json={"text": "once"}).json()
    assert client.delete(f"/api/notes/{post['id']}").status_code == 204
    r = client.delete(f"/api/notes/{post['id']}")
    assert r.status_code == 404


def test_get_note_file_returns_markdown(client):
    post = client.post("/api/notes", json={"text": "# heading\n\nbody here"}).json()
    r = client.get(f"/api/notes/{post['id']}/file")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert "# heading" in r.text

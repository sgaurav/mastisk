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

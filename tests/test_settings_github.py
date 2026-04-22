"""Tests for GitHub settings endpoints + TOML write helper."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
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


def test_update_toml_key_creates_file(data_tmp):
    from mastisk.paths import config_path
    from mastisk.settings import update_toml_key
    assert not config_path().exists()
    update_toml_key("github", "pat", "ghp_test123")
    assert config_path().exists()
    text = config_path().read_text()
    assert "ghp_test123" in text
    assert "[github]" in text


def test_update_toml_key_preserves_other_keys(data_tmp):
    import tomllib

    from mastisk.paths import config_path
    from mastisk.settings import update_toml_key
    # Seed with other content
    config_path().parent.mkdir(parents=True, exist_ok=True)
    config_path().write_text(
        '[other]\nvalue = "keep-me"\n\n[github]\npat = "old"\nideas_per_run = 7\n'
    )
    update_toml_key("github", "pat", "new-pat")
    with config_path().open("rb") as f:
        data = tomllib.load(f)
    assert data["github"]["pat"] == "new-pat"
    assert data["github"]["ideas_per_run"] == 7   # preserved
    assert data["other"]["value"] == "keep-me"


def test_get_github_settings_hides_pat(client):
    r = client.get("/api/settings/github")
    assert r.status_code == 200
    body = r.json()
    assert body["pat_set"] is False
    assert body["pat_last4"] is None


def test_set_pat_and_readback(client, data_tmp):
    r = client.put("/api/settings/github/pat", json={"pat": "ghp_abcdefghijklmnop"})
    assert r.status_code == 200
    body = r.json()
    assert body["pat_set"] is True
    assert body["pat_last4"] == "…mnop"

    r2 = client.get("/api/settings/github")
    assert r2.status_code == 200
    assert r2.json()["pat_set"] is True


def test_clear_pat(client, data_tmp):
    client.put("/api/settings/github/pat", json={"pat": "ghp_abcdef123456"})
    r = client.put("/api/settings/github/pat", json={"pat": ""})
    assert r.status_code == 200
    assert r.json()["pat_set"] is False


def test_test_pat_no_pat_configured(client):
    r = client.get("/api/settings/github/test")
    assert r.status_code == 422
    assert "no PAT" in r.json()["detail"]


def test_test_pat_authenticated(client, data_tmp):
    client.put("/api/settings/github/pat", json={"pat": "ghp_fake"})
    fake_resp = httpx.Response(
        status_code=200,
        json={"login": "testuser", "name": "Test User", "public_repos": 42},
        request=httpx.Request("GET", "https://api.github.com/user"),
    )
    with patch.object(httpx.AsyncClient, "get", new=AsyncMock(return_value=fake_resp)):
        r = client.get("/api/settings/github/test")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["username"] == "testuser"


def test_test_pat_401(client, data_tmp):
    client.put("/api/settings/github/pat", json={"pat": "ghp_invalid"})
    fake_resp = httpx.Response(
        status_code=401,
        json={"message": "Bad credentials"},
        request=httpx.Request("GET", "https://api.github.com/user"),
    )
    with patch.object(httpx.AsyncClient, "get", new=AsyncMock(return_value=fake_resp)):
        r = client.get("/api/settings/github/test")
    assert r.status_code == 401
    assert "invalid" in r.json()["detail"]

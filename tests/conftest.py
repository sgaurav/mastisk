"""Shared pytest fixtures. Isolates DB + vault per test so nothing touches the real ~/Library paths."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def vault_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point MASTISK_VAULT at a tmp dir; clear the lru_cache so it takes effect."""
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setenv("MASTISK_VAULT", str(vault))
    # Clear cached path resolvers
    from mastisk import paths
    paths.vault_dir.cache_clear()
    paths.data_dir.cache_clear()
    return vault


@pytest.fixture
def data_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setenv("MASTISK_HOME", str(data))
    from mastisk import paths
    paths.data_dir.cache_clear()
    paths.vault_dir.cache_clear()
    return data


@pytest.fixture
def db(vault_tmp: Path, data_tmp: Path) -> sqlite3.Connection:
    """Fresh SQLite at data_tmp/mastisk.db, schema applied."""
    from mastisk.db.queries import connect, init_schema
    conn = connect()  # uses db_path() which reads data_dir() → data_tmp
    init_schema(conn)
    yield conn
    conn.close()

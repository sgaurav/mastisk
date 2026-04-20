"""Expose identity files + vault metadata so the UI can show/edit self.md etc."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from mastisk.paths import self_dir, vault_dir, vault_is_icloud

router = APIRouter(tags=["vault"])

_SELF_FILES = ("identity", "interests", "dislikes", "style", "learnings")


@router.get("/vault/info")
def info():
    return {
        "vault_path": str(vault_dir()),
        "icloud": vault_is_icloud(),
        "self_files": _SELF_FILES,
    }


@router.get("/vault/self/{name}")
def read_self(name: str):
    if name not in _SELF_FILES:
        raise HTTPException(404, "unknown self file")
    p = self_dir() / f"{name}.md"
    return {"name": name, "content": p.read_text() if p.exists() else ""}


class SelfIn(BaseModel):
    content: str


@router.put("/vault/self/{name}")
def write_self(name: str, body: SelfIn):
    if name not in _SELF_FILES:
        raise HTTPException(404, "unknown self file")
    self_dir().mkdir(parents=True, exist_ok=True)
    (self_dir() / f"{name}.md").write_text(body.content)
    return {"ok": True}

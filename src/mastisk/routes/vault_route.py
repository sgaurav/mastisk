"""Expose identity files + vault metadata so the UI can show/edit self.md etc."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from mastisk.paths import self_dir, vault_dir, vault_is_icloud
from mastisk.routes.notes import atomic_write

router = APIRouter(tags=["vault"])

_SELF_FILES = ("identity", "interests", "dislikes", "style", "learnings")


@router.get("/vault/info")
def info():
    return {
        "vault_path": str(vault_dir()),
        "icloud": vault_is_icloud(),
        "self_files": _SELF_FILES,
    }


@router.get("/vault/self")
def list_self():
    out = []
    for name in _SELF_FILES:
        p = self_dir() / f"{name}.md"
        if p.exists():
            st = p.stat()
            out.append({"name": name, "size": st.st_size, "mtime": st.st_mtime, "exists": True})
        else:
            out.append({"name": name, "size": 0, "mtime": 0.0, "exists": False})
    return {"files": out}


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
    atomic_write(self_dir() / f"{name}.md", body.content)
    return {"ok": True}

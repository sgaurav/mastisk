"""Repos API — register GitHub repos for ingestion + ideation."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from mastisk.agents.base import enqueue
from mastisk.bridges import github_bridge
from mastisk.db import queries as q
from mastisk.db.queries import connect
from mastisk.settings import get_settings

router = APIRouter(prefix="/api/repos", tags=["repos"])


class AddRepoRequest(BaseModel):
    slug: str = Field(min_length=3)


class AddLocalRepoRequest(BaseModel):
    path: str = Field(min_length=1)


def _parse_slug(slug: str) -> tuple[str, str]:
    s = slug.strip().lower()
    if "/" not in s or s.count("/") != 1:
        raise HTTPException(status_code=422, detail="slug must be 'owner/repo'")
    owner, name = s.split("/", 1)
    if not owner or not name:
        raise HTTPException(status_code=422, detail="slug must be 'owner/repo'")
    return owner, name


@router.post("", status_code=201)
async def add_repo_endpoint(req: AddRepoRequest) -> dict:
    owner, name = _parse_slug(req.slug)
    # Verify the repo exists (via GitHub API)
    try:
        meta = await github_bridge.fetch_repo_metadata(owner, name)
    except github_bridge.GithubNotFound:
        # Tailor the hint to whether a PAT is configured. Without a PAT, a 404
        # most often means the repo is private and unreachable — so point the
        # user at Settings. With a PAT, the more likely cause is the PAT not
        # having access to this specific org/repo.
        has_pat = bool(get_settings().github.pat)
        if has_pat:
            detail = "repo not found on GitHub (or your PAT doesn't have access to it)"
        else:
            detail = "repo not found. If this is a private repo, add a GitHub PAT via Settings → GitHub, then retry."
        raise HTTPException(status_code=404, detail=detail)
    except github_bridge.GithubAuthError:
        raise HTTPException(status_code=401, detail="GitHub PAT invalid or missing scope")
    except github_bridge.GithubRateLimited:
        raise HTTPException(status_code=429, detail="GitHub rate limit exceeded; try later")
    except github_bridge.GithubError as e:
        raise HTTPException(status_code=502, detail=f"GitHub error: {e}")

    slug = meta["slug"]
    with connect() as conn:
        q.insert_repo(
            conn, slug=slug, owner=meta["owner"], name=meta["name"],
            display_name=meta["display_name"], description=meta["description"],
            default_branch=meta["default_branch"], is_private=meta["is_private"],
        )
    enqueue("github_poller", "poll", {"repo_slug": slug})
    return {
        "slug": slug,
        "display_name": meta["display_name"],
        "description": meta["description"],
    }


@router.post("/local", status_code=201)
async def add_local_repo_endpoint(req: AddLocalRepoRequest) -> dict:
    from pathlib import Path
    from mastisk.bridges import local_git_bridge
    p = Path(req.path).expanduser().resolve()
    if not p.is_dir():
        raise HTTPException(status_code=422, detail=f"not a directory: {p}")
    if not (p / ".git").exists():
        raise HTTPException(status_code=422, detail=f"not a git repo: {p}")
    slug = local_git_bridge.derive_local_slug(p)
    with connect() as conn:
        # Insert (or un-tombstone) a local repo row
        conn.execute(
            """INSERT OR REPLACE INTO repos
               (slug, source_type, owner, name, display_name, description,
                default_branch, is_private, local_path, added_at, deleted_at)
               VALUES (?, 'local', 'local', ?, ?, NULL, NULL, 0, ?,
                       COALESCE((SELECT added_at FROM repos WHERE slug = ?), CURRENT_TIMESTAMP),
                       NULL)""",
            (slug, p.name, f"local:{p.name}", str(p), slug),
        )
    enqueue("github_poller", "poll", {"repo_slug": slug})
    return {"slug": slug, "local_path": str(p), "display_name": f"local:{p.name}"}


@router.get("")
async def list_repos_endpoint() -> list[dict]:
    with connect() as conn:
        rows = q.list_repos(conn)
    result = []
    for r in rows:
        with connect() as conn:
            snap = q.latest_repo_snapshot(conn, r["slug"])
        result.append({
            "slug": r["slug"],
            "source_type": r.get("source_type") or "github",
            "local_path": r.get("local_path"),
            "display_name": r["display_name"],
            "description": r["description"],
            "is_private": bool(r["is_private"]),
            "last_polled_at": r["last_polled_at"],
            "last_ideated_at": r["last_ideated_at"],
            "snapshot": {
                "polled_at": snap["polled_at"] if snap else None,
                "stars_count": snap["stars_count"] if snap else None,
                "forks_count": snap["forks_count"] if snap else None,
                "open_issues_count": snap["open_issues_count"] if snap else None,
                "open_prs_count": snap["open_prs_count"] if snap else None,
                "error": snap["error"] if snap else None,
            } if snap else None,
        })
    return result


def _repo_detail_payload(r: dict, snap: dict | None) -> dict:
    return {
        "slug": r["slug"],
        "source_type": r.get("source_type") or "github",
        "local_path": r.get("local_path"),
        "display_name": r["display_name"],
        "description": r["description"],
        "is_private": bool(r["is_private"]),
        "default_branch": r["default_branch"],
        "added_at": r["added_at"],
        "last_polled_at": r["last_polled_at"],
        "last_ideated_at": r["last_ideated_at"],
        "context_md": r["context_md"],
        "latest_snapshot": snap,
    }


# ─── Slug-indexed endpoints (frontend uses these) ─────────────────────────
# Local repos have slugs like `local:/Users/foo` with colons + slashes that
# collide with the /{owner}/{name} shape. We use `{slug:path}` with a verb
# root (`/by-slug/`, `/poll/`, `/ideate/`) so the greedy path converter has
# no other segments to compete with. Frontend can send slug raw — the only
# char that would break the URL is `#`, which slugs don't contain.

@router.get("/by-slug/{slug:path}")
async def get_repo_by_slug_endpoint(slug: str) -> dict:
    with connect() as conn:
        r = q.get_repo(conn, slug)
        if r is None or r.get("deleted_at") is not None:
            raise HTTPException(status_code=404, detail="repo not found")
        snap = q.latest_repo_snapshot(conn, slug)
    return _repo_detail_payload(r, snap)


@router.delete("/by-slug/{slug:path}", status_code=204)
async def delete_repo_by_slug_endpoint(slug: str) -> None:
    with connect() as conn:
        r = q.get_repo(conn, slug)
        if r is None or r.get("deleted_at") is not None:
            raise HTTPException(status_code=404, detail="repo not found")
        q.soft_delete_repo(conn, slug)


@router.post("/poll/{slug:path}", status_code=202)
async def poll_now_by_slug_endpoint(slug: str) -> dict:
    with connect() as conn:
        r = q.get_repo(conn, slug)
    if r is None or r.get("deleted_at") is not None:
        raise HTTPException(status_code=404, detail="repo not found")
    enqueue("github_poller", "poll", {"repo_slug": slug})
    return {"ok": True}


@router.post("/ideate/{slug:path}", status_code=202)
async def ideate_now_by_slug_endpoint(slug: str) -> dict:
    with connect() as conn:
        r = q.get_repo(conn, slug)
    if r is None or r.get("deleted_at") is not None:
        raise HTTPException(status_code=404, detail="repo not found")
    enqueue("github_ideator", "ideate", {"repo_slug": slug})
    return {"ok": True}


# ─── /{owner}/{name} — legacy github-only endpoints, kept for bookmarks ───

@router.get("/{owner}/{name}")
async def get_repo_endpoint(owner: str, name: str) -> dict:
    slug = f"{owner.lower()}/{name.lower()}"
    with connect() as conn:
        r = q.get_repo(conn, slug)
        if r is None or r.get("deleted_at") is not None:
            raise HTTPException(status_code=404, detail="repo not found")
        snap = q.latest_repo_snapshot(conn, slug)
    return _repo_detail_payload(r, snap)


@router.delete("/{owner}/{name}", status_code=204)
async def delete_repo_endpoint(owner: str, name: str) -> None:
    slug = f"{owner.lower()}/{name.lower()}"
    with connect() as conn:
        r = q.get_repo(conn, slug)
        if r is None or r.get("deleted_at") is not None:
            raise HTTPException(status_code=404, detail="repo not found")
        q.soft_delete_repo(conn, slug)


@router.post("/{owner}/{name}/poll-now", status_code=202)
async def poll_now_endpoint(owner: str, name: str) -> dict:
    slug = f"{owner.lower()}/{name.lower()}"
    with connect() as conn:
        r = q.get_repo(conn, slug)
    if r is None or r.get("deleted_at") is not None:
        raise HTTPException(status_code=404, detail="repo not found")
    enqueue("github_poller", "poll", {"repo_slug": slug})
    return {"ok": True}


@router.post("/{owner}/{name}/ideate-now", status_code=202)
async def ideate_now_endpoint(owner: str, name: str) -> dict:
    slug = f"{owner.lower()}/{name.lower()}"
    with connect() as conn:
        r = q.get_repo(conn, slug)
    if r is None or r.get("deleted_at") is not None:
        raise HTTPException(status_code=404, detail="repo not found")
    enqueue("github_ideator", "ideate", {"repo_slug": slug})
    return {"ok": True}

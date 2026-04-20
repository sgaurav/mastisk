"""mastisk CLI — the self-serve surface.

Wired up in pyproject.toml as the console_script entry point.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from mastisk import __version__
from mastisk.paths import (
    APP_SUPPORT, ICLOUD_ROOT, config_path, data_dir, db_path,
    ensure_dirs, log_dir, self_dir, vault_dir, vault_is_icloud,
)

app = typer.Typer(
    name="mastisk",
    help="Personal knowledge wiki with 24/7 agents (Claude + Ollama, vault in iCloud).",
    no_args_is_help=True,
    add_completion=False,
)
console = Console()


# ═════════════════════════════════ start / dev ═════════════════════════════════

@app.command()
def start(
    host: str = typer.Option("0.0.0.0", "--host", "-h", envvar="MASTISK_HOST"),
    port: int = typer.Option(8080, "--port", "-p", envvar="MASTISK_PORT"),
):
    """Run Mastisk in the foreground."""
    import uvicorn
    ensure_dirs()
    _ensure_db()
    console.print(f"[bold]Mastisk {__version__}[/bold] starting on http://{host}:{port}")
    console.print(f"  vault: {vault_dir()} {'[dim](iCloud)[/dim]' if vault_is_icloud() else '[dim](local)[/dim]'}")
    console.print(f"  data:  {data_dir()}")
    uvicorn.run("mastisk.app:create_app", factory=True, host=host, port=port, log_level="info")


@app.command()
def dev(port: int = typer.Option(8080)):
    """Dev mode: vite dev server + hot-reloading backend. Requires repo checkout with frontend/."""
    from concurrent.futures import ThreadPoolExecutor
    ensure_dirs()
    _ensure_db()
    frontend = Path.cwd() / "frontend"
    if not frontend.exists():
        console.print("[red]frontend/ not found — run this from the repo checkout[/red]")
        raise typer.Exit(1)
    console.print("[bold]dev mode: vite + uvicorn[/bold]")
    with ThreadPoolExecutor(max_workers=2) as pool:
        pool.submit(_run, ["npm", "run", "dev"], cwd=frontend)
        pool.submit(_run, [sys.executable, "-m", "uvicorn", "mastisk.app:create_app",
                           "--factory", "--reload", "--host", "0.0.0.0", "--port", str(port)])


def _run(cmd, cwd: Optional[Path] = None):
    proc = subprocess.Popen(cmd, cwd=cwd)
    proc.wait()


# ═════════════════════════════════ doctor ═════════════════════════════════

@app.command()
def doctor():
    """Check preconditions: claude, ollama, tailscale, iCloud dir, deps."""
    tbl = Table(show_header=True, header_style="bold")
    tbl.add_column("check")
    tbl.add_column("status")
    tbl.add_column("notes")

    def ok(name, note=""):
        tbl.add_row(name, "[green]ok[/green]", note)

    def bad(name, note=""):
        tbl.add_row(name, "[red]missing[/red]", note)

    def warn(name, note=""):
        tbl.add_row(name, "[yellow]warn[/yellow]", note)

    # Python
    v = sys.version_info
    if v >= (3, 11):
        ok("python", f"{v.major}.{v.minor}.{v.micro}")
    else:
        bad("python", f"need >= 3.11, have {v.major}.{v.minor}")

    # claude
    claude = shutil.which("claude")
    if claude:
        try:
            out = subprocess.check_output([claude, "--version"], stderr=subprocess.STDOUT, timeout=5).decode().strip()
            ok("claude", out)
        except Exception as e:
            warn("claude", f"{claude} but --version failed: {e}")
    else:
        bad("claude", "install from https://claude.com/claude-code")

    # ollama
    ollama = shutil.which("ollama")
    if ollama:
        try:
            out = subprocess.check_output([ollama, "--version"], stderr=subprocess.STDOUT, timeout=5).decode().strip()
            ok("ollama", out)
        except Exception as e:
            warn("ollama", f"{ollama} but --version failed: {e}")
    else:
        warn("ollama", "optional for local fallback — brew install ollama")

    # tailscale
    ts = _tailscale_binary()
    if ts:
        hostname = _tailscale_hostname()
        ok("tailscale", hostname or "installed (not logged in?)")
    else:
        warn("tailscale", "optional for phone access — brew install --cask tailscale")

    # iCloud
    if ICLOUD_ROOT.is_dir():
        ok("iCloud", f"vault will live in {ICLOUD_ROOT}/Mastisk/vault")
    else:
        warn("iCloud", f"not detected; vault will fall back to {APP_SUPPORT}/vault")

    # Config
    if config_path().exists():
        ok("config", str(config_path()))
    else:
        warn("config", f"not found; run `mastisk init` to create {config_path()}")

    console.print(tbl)


# ═════════════════════════════════ init ═════════════════════════════════

@app.command()
def init(
    ollama_key: Optional[str] = typer.Option(None, "--ollama-key", help="Ollama Cloud API key"),
    demo: bool = typer.Option(False, "--demo", help="Also load the demo wiki (Test-time compute + friends)"),
    force: bool = typer.Option(False, "--force", help="Overwrite existing config + self files"),
):
    """First-time setup: create dirs, empty DB, starter self files. No demo data unless --demo."""
    ensure_dirs()
    _write_self_templates(force=force)

    # Config
    if not config_path().exists() or force:
        key = ollama_key or os.environ.get("OLLAMA_CLOUD_KEY", "")
        if not key and sys.stdin.isatty():
            key = typer.prompt(
                "Ollama Cloud API key (press Enter to skip; local Ollama will be used)",
                default="",
                show_default=False,
            )
        config_path().write_text(_config_template(key))
        config_path().chmod(0o600)
        console.print(f"[green]wrote[/green] {config_path()}")

    # DB schema only
    from mastisk.db.queries import init_schema
    init_schema()
    console.print(f"[green]db ready[/green] {db_path()} [dim](empty)[/dim]")

    if demo:
        _seed_demo()

    # Summary
    console.print()
    console.print("[bold]Mastisk ready.[/bold]")
    console.print(f"  vault: {vault_dir()}  {'(iCloud)' if vault_is_icloud() else '(local)'}")
    console.print(f"  data:  {data_dir()}")
    console.print(f"  self:  {self_dir()}  [dim]← edit identity.md, interests.md, style.md[/dim]")
    console.print()
    console.print("  next:  mastisk start")
    if not demo:
        console.print("  tip:   mastisk add-feed <url>  [dim]— subscribe a feed to kick off Scout[/dim]")


@app.command(name="seed-demo")
def seed_demo_cmd():
    """Load the Test-time compute demo wiki (what the design shows). Safe to run again."""
    _seed_demo()


@app.command()
def reset(
    keep_feeds: bool = typer.Option(True, "--keep-feeds/--wipe-feeds", help="Keep subscribed RSS feeds"),
    keep_vault: bool = typer.Option(True, "--keep-vault/--wipe-vault", help="Keep vault markdown files"),
    yes: bool = typer.Option(False, "--yes", "-y", help="Don't prompt for confirmation"),
):
    """Wipe all wiki content (articles, sources, feed ticker, jobs, signals). Keeps identity + config."""
    if not yes:
        if not typer.confirm(
            f"About to wipe all wiki content from {db_path()}.\n"
            f"  feeds:  {'kept' if keep_feeds else 'wiped'}\n"
            f"  vault:  {'kept' if keep_vault else 'wiped'}\n"
            f"  identity files + config are always kept.\n"
            f"Proceed?",
            default=False,
        ):
            console.print("aborted")
            raise typer.Exit(1)

    from mastisk.db.queries import connect, init_schema
    init_schema()
    tables = [
        "signals", "jobs", "feed",
        "article_sources", "article_embeddings", "article_sections",
        "links", "pinned",
        "sources", "articles",
    ]
    if not keep_feeds:
        tables.append("rss_feeds")
    with connect() as conn:
        for t in tables:
            conn.execute(f"DELETE FROM {t}")
        conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('feed','jobs','signals')")
        conn.execute("INSERT INTO articles_fts(articles_fts) VALUES('rebuild')")
    console.print(f"[green]wiped[/green] {', '.join(tables)}")

    if not keep_vault:
        import shutil
        for sub in ("concepts", "entities", "sources", "synthesis"):
            d = vault_dir() / sub
            if d.exists():
                shutil.rmtree(d)
                d.mkdir()
        console.print(f"[green]wiped vault[/green] (kept _self/)")


def _seed_demo() -> None:
    from mastisk.db.seed import seed
    s = seed()
    console.print(f"[green]seeded demo[/green] {s['articles']} articles, {s['feed']} feed entries")


# ═════════════════════════════════ add-feed / add-youtube ═════════════════════════════════

@app.command(name="add-feed")
def add_feed(url: str, title: Optional[str] = typer.Option(None, "--title", "-t")):
    """Subscribe to an RSS feed."""
    from mastisk.db.queries import connect
    _ensure_db()
    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO rss_feeds (url, title, enabled) VALUES (?, ?, 1)",
            (url, title or url),
        )
    console.print(f"[green]subscribed[/green] {url}")


@app.command(name="add-youtube")
def add_youtube(url: str):
    """Queue a YouTube URL for the Listener agent."""
    from mastisk.agents.base import enqueue
    _ensure_db()
    job_id = enqueue("listener", "transcribe", {"url": url})
    console.print(f"[green]queued[/green] job {job_id}  (Listener will pick it up on next tick)")


# ═════════════════════════════════ url / logs / vault-path ═════════════════════════════════

@app.command()
def url():
    """Print desktop, LAN, and Tailnet URLs for this Mastisk instance."""
    from mastisk.settings import get_settings
    s = get_settings()
    port = s.port

    console.print(f"[bold]Desktop[/bold]  http://localhost:{port}")

    lan = _lan_ip()
    if lan:
        console.print(f"[bold]LAN    [/bold]  http://{lan}:{port}")

    tailnet = _tailscale_hostname()
    if tailnet:
        console.print(f"[bold]Tailnet[/bold]  http://{tailnet}:{port}  [dim]← open this in Safari on your phone[/dim]")
    else:
        console.print("[dim]Tailnet: not available (open Tailscale app and log in, then retry)[/dim]")


@app.command()
def logs(n: int = 50):
    """Tail the latest N feed entries (agent activity)."""
    from mastisk.db import queries as q
    from mastisk.db.queries import connect
    with connect() as conn:
        entries = q.recent_feed(conn, limit=n)
    for e in reversed(entries):
        console.print(f"[dim]{e['t']:>4}[/dim]  [cyan]{e['agent']:<12}[/cyan]  {e['verb']:<11} {e['obj']}")


@app.command(name="vault-path")
def vault_path_cmd():
    """Print where the vault lives."""
    console.print(str(vault_dir()))


@app.command()
def backup(output_dir: Optional[Path] = typer.Option(None, "--output-dir", "-o")):
    """Tar the DB + config to a timestamped archive."""
    import tarfile
    from datetime import datetime
    target_dir = output_dir or Path.cwd()
    target_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    out = target_dir / f"mastisk-backup-{ts}.tar.gz"
    with tarfile.open(out, "w:gz") as tar:
        if db_path().exists():
            tar.add(db_path(), arcname="mastisk.db")
        if config_path().exists():
            tar.add(config_path(), arcname="config.toml")
    console.print(f"[green]backup[/green] {out}")


# ═════════════════════════════════ autostart ═════════════════════════════════

_PLIST_LABEL = "com.mastisk.agents"
_PLIST_PATH = Path.home() / "Library" / "LaunchAgents" / f"{_PLIST_LABEL}.plist"


@app.command(name="enable-autostart")
def enable_autostart():
    """Install a launchd agent that starts Mastisk on login."""
    binary = shutil.which("mastisk") or sys.argv[0]
    log_file = log_dir() / "mastisk.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    _PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PLIST_PATH.write_text(_plist_template(binary, str(log_file)))
    subprocess.run(["launchctl", "load", str(_PLIST_PATH)], check=False)
    console.print(f"[green]enabled[/green] {_PLIST_PATH}")
    console.print(f"       logs at {log_file}")


@app.command(name="disable-autostart")
def disable_autostart():
    """Remove the launchd agent."""
    subprocess.run(["launchctl", "unload", str(_PLIST_PATH)], check=False)
    if _PLIST_PATH.exists():
        _PLIST_PATH.unlink()
        console.print(f"[green]removed[/green] {_PLIST_PATH}")
    else:
        console.print(f"[dim]already disabled[/dim] ({_PLIST_PATH})")


# ═════════════════════════════════ helpers ═════════════════════════════════

def _ensure_db() -> None:
    """Ensure the DB schema exists. Does NOT seed — seeding is explicit via `init --demo` or `seed-demo`."""
    from mastisk.db.queries import init_schema
    init_schema()


def _lan_ip() -> Optional[str]:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def _tailscale_binary() -> Optional[str]:
    for candidate in [
        shutil.which("tailscale"),
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "/usr/local/bin/tailscale",
    ]:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def _tailscale_hostname() -> Optional[str]:
    ts = _tailscale_binary()
    if not ts:
        return None
    try:
        out = subprocess.check_output([ts, "status", "--json"], stderr=subprocess.DEVNULL, timeout=3).decode()
        data = json.loads(out)
        self_node = data.get("Self") or {}
        dns = self_node.get("DNSName", "")
        return dns.rstrip(".") or None
    except Exception:
        return None


def _write_self_templates(force: bool = False) -> None:
    self_dir().mkdir(parents=True, exist_ok=True)
    templates = {
        "identity.md": _IDENTITY_TEMPLATE,
        "interests.md": _INTERESTS_TEMPLATE,
        "dislikes.md": _DISLIKES_TEMPLATE,
        "style.md": _STYLE_TEMPLATE,
        "learnings.md": _LEARNINGS_TEMPLATE,
    }
    for name, content in templates.items():
        p = self_dir() / name
        if p.exists() and not force:
            continue
        p.write_text(content)


def _config_template(ollama_key: str) -> str:
    return f'''# Mastisk config — written by `mastisk init`. Safe to edit.
# Secrets live here (never in the iCloud vault).

ollama_cloud_key = "{ollama_key}"
ollama_local_only = {"true" if not ollama_key else "false"}

# embed_model = "nomic-embed-text"
# summarize_model_heavy = "llama3.3:70b"
# summarize_model_cheap = "llama3.2:3b"

[budget]
scout = 500
listener = 20
compiler = 100
linter = 50
synthesizer = 10
'''


def _plist_template(binary: str, log_path: str) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{_PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{binary}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>StandardOutPath</key><string>{log_path}</string>
  <key>StandardErrorPath</key><string>{log_path}</string>
</dict>
</plist>
'''


_IDENTITY_TEMPLATE = """# Who I am

## Role
(e.g. "Staff engineer at X, building AI infra")

## Expertise — deep
(bullet topics where a 1-line summary is enough; you want depth and nuance)
-

## Expertise — learning
(bullet topics where you want beginner framing)
-

## Reading preference
(Serif or sans? Long-form or bullets? Default: serif long-form with TL;DR-first)
"""

_INTERESTS_TEMPLATE = """# Topics I want tracked
(One bullet per topic. Scout gates RSS items against these.)
- AI research (test-time compute, RL on LLMs, mech interp)
- AI infrastructure
- Developer tools
"""

_DISLIKES_TEMPLATE = """# Topics to filter out
(One per line. Substring match on article title + summary. Lowercase fine.)
- celebrity
- crypto price
- meme stocks
"""

_STYLE_TEMPLATE = """# How I want articles written

- Lead with a TL;DR callout
- Be concrete about what's new vs what's old
- Flag uncertainty — don't assert what isn't known
- No marketing tone. No em-dashes-for-drama. Plain prose.
- If the source is advocacy, note it
- If there's a counter-argument, include it
"""

_LEARNINGS_TEMPLATE = """# Auto-learnings
(Appended by the Reflection agent once it's running. Prune freely.)
"""

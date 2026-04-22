# Mastisk

A personal knowledge wiki with 24/7 research agents. Runs locally on your Mac, uses your Claude Code subscription + Ollama, syncs the vault via iCloud, and installs as a PWA on your phone via Tailscale.

---

## Install (one command)

```bash
git clone <this-repo> ~/Code/mastisk
cd ~/Code/mastisk
./install.sh --autostart
```

That's it. `install.sh` checks prereqs, builds the frontend, installs the Python package via `uv tool`, pulls an embed model, initializes config + iCloud vault, enables launch-at-login, and prints your phone URL.

Want the demo wiki (Test-time compute + friends) to see what it looks like populated?
```bash
./install.sh --autostart --demo
```

Update to the latest code (git pull + rebuild + reinstall + restart):
```bash
mastisk update            # works from anywhere once installed
mastisk update --check    # show pending commits without applying
# or equivalently:
./install.sh --update     # same thing, script form
```

Uninstall (preserves your iCloud vault):
```bash
./install.sh --uninstall
```

---

## Prerequisites (install these first)

| tool | install | required? | why |
|---|---|---|---|
| **uv** | `curl -LsSf https://astral.sh/uv/install.sh \| sh` | yes | isolated Python tool install |
| **node** | `brew install node` | yes | to build the frontend once |
| **claude** | [claude.com/claude-code](https://claude.com/claude-code) + `claude login` | yes | agents use your Claude subscription |
| **ollama** | `brew install ollama` | optional but recommended | local + cloud-proxied models, embeddings |
| **tailscale** | `brew install --cask tailscale` or App Store | optional | phone access from anywhere |

`install.sh` verifies these and tells you which are missing.

---

## Keys & configuration — where things live

| what | where | format | required? |
|---|---|---|---|
| **Claude auth** | managed by `claude` CLI | — | required; run `claude login` |
| **Ollama Cloud API key** | `~/Library/Application Support/Mastisk/config.toml` → `ollama_cloud_key` | string | optional; skip to use local Ollama only |
| **Tailscale auth** | Tailscale app (menu-bar icon) | — | optional; only if you want phone access |
| **RSS feeds** | SQLite `rss_feeds` table, managed via `mastisk add-feed` | URL list | needed for Scout to have anything to do |
| **iCloud sync toggle** | Settings → Apple ID → iCloud → iCloud Drive → on | — | required for phone-side vault access |

### Setting the Ollama Cloud key

Three ways:

```bash
# 1. At install time (prompts interactively)
mastisk init

# 2. Non-interactively
mastisk init --ollama-key sk-xxx

# 3. Edit directly later (the file is human-readable)
open ~/Library/Application\ Support/Mastisk/config.toml
```

The config file also holds per-agent budget caps and model selection. Safe to edit.

**Tip:** if you're signed in to Ollama Cloud via the Ollama app on your Mac (`ollama signin`), local Ollama transparently proxies `:cloud`-tagged models. In that mode you don't strictly need to put the cloud API key in Mastisk's config.

### What *not* to add keys for

- **Anthropic API key** — not needed. Mastisk uses the `claude` CLI subprocess, which uses your existing Claude Code session.
- **YouTube / podcast keys** — not needed. Listener uses `yt-dlp` which doesn't require auth for public content.

---

## Running it

```bash
mastisk start    # foreground, Ctrl-C to stop
```

### Auto-start on login

Enable it once:
```bash
mastisk enable-autostart
```
This installs `~/Library/LaunchAgents/com.mastisk.agents.plist` with `RunAtLoad=true`, so Mastisk starts whenever you log in. **By design it does NOT auto-restart if it crashes** (to prevent a runaway loop burning your Claude quota). If Mastisk quits mid-session, log out and log back in — or:

```bash
launchctl kickstart gui/$(id -u)/com.mastisk.agents    # start it right now
launchctl kill SIGTERM gui/$(id -u)/com.mastisk.agents # stop it
```

Disable auto-start:
```bash
mastisk disable-autostart
```

Logs when running via autostart:
```bash
tail -f ~/Library/Application\ Support/Mastisk/logs/mastisk.log
```

---

## Phone setup

1. Install the **Tailscale** app on your phone, sign in to the same tailnet as your Mac
2. On your Mac: `mastisk url` — copy the Tailnet line (`http://<hostname>.tailXXXXX.ts.net:8080`)
3. Open that URL in Safari on your phone
4. Tap the Share icon → **Add to Home Screen**

You now have a Mastisk icon that launches full-screen. It's a PWA — works offline for cached articles, syncs when you're back online.

You also get a **second reading path** via iCloud: **Files app → iCloud Drive → Mastisk → vault → `*.md`**. Plain markdown, opens in Obsidian too. The PWA is the rich UX; the iCloud vault is the fallback when your Mac is offline.

---

## Shape what the agents produce

Agents load `vault/_self/*.md` into every prompt. Edit these files — on your Mac OR your phone via iCloud Drive — to steer the wiki.

```
vault/_self/
├─ identity.md      who you are, role, expertise
├─ interests.md     topics Scout should track (embedding similarity gate)
├─ dislikes.md      topics to filter out (substring match on title+summary)
├─ style.md         how you want content written
└─ learnings.md     auto-appended by the Reflection agent (M2)
```

Open the folder on Mac:
```bash
open ~/Library/Mobile\ Documents/com~apple~CloudDocs/Mastisk/vault/_self
```

Changes apply on the next agent run — no restart needed.

---

## Bootstrap content

From clean state, three ways to get started:

```bash
# Subscribe a real RSS feed — Scout polls every 10 min
mastisk add-feed https://simonwillison.net/atom/everything/

# Queue a YouTube video for transcription
mastisk add-youtube https://www.youtube.com/watch?v=...

# Load the sample wiki (Test-time compute + friends)
mastisk seed-demo
```

Watch the agents work:
```bash
mastisk logs -n 50    # tail the feed ticker
```

---

## Commands reference

```
mastisk doctor              check preconditions
mastisk status              full content + agents + bridges report
mastisk status --ping       same, plus live Claude + Ollama smoke test
mastisk update              git pull + rebuild + reinstall + restart
mastisk update --check      show pending commits without applying
mastisk init                first-time setup (empty DB)
mastisk init --demo         first-time setup + seed the demo wiki
mastisk seed-demo           load the demo wiki onto an existing install
mastisk reset               wipe wiki content (keeps identity + config + feeds)
mastisk reset --wipe-vault  wipe markdown vault too
mastisk start               run the app (foreground)
mastisk dev                 dev mode with reload (repo-checkout only)
mastisk url                 print Desktop + LAN + Tailnet URLs
mastisk add-feed <url>      subscribe an RSS feed
mastisk add-youtube <url>   queue a video for Listener
mastisk note [text]         capture a note (opens $EDITOR if no text)
mastisk logs                tail agent activity
mastisk vault-path          show where the vault lives
mastisk backup              tar the DB + config to ./mastisk-backup-*.tar.gz
mastisk enable-autostart    install launchd agent (opt-in)
mastisk disable-autostart   remove launchd agent
```

---

## Capturing notes

Three ways, any combination:

- **PWA:** click the `+` in the titlebar, type, ⌘↵ to save.
- **CLI:** `mastisk note "a quick thought"` or `mastisk note` (opens `$EDITOR`).
- **Any editor:** drop a `.md` file into `vault/_notes/inbox/` — Obsidian, Files app, vim, iOS Shortcut to Files, etc.

Notes live in `vault/_notes/YYYY-MM-DD/` once classified. Phase 2 (classification by the Notetaker agent) is next.

---

## What lives where

| kind | path | synced? |
|---|---|---|
| Python package + venv | `~/.local/share/uv/tools/mastisk/` | no |
| CLI binary | `~/.local/bin/mastisk` | no |
| Config (with secrets) | `~/Library/Application Support/Mastisk/config.toml` | no |
| SQLite DB | `~/Library/Application Support/Mastisk/mastisk.db` | no (iCloud would corrupt live writes) |
| Raw artifacts (html, audio, transcripts) | `~/Library/Application Support/Mastisk/raw/` | no |
| Logs | `~/Library/Application Support/Mastisk/logs/` | no |
| Launchd plist (if autostart enabled) | `~/Library/LaunchAgents/com.mastisk.agents.plist` | no |
| **Markdown vault** | `~/Library/Mobile Documents/com~apple~CloudDocs/Mastisk/vault/` | **yes — iCloud** |

---

## Uninstall

```bash
./install.sh --uninstall
```

Equivalent to:
```bash
mastisk disable-autostart
uv tool uninstall mastisk
rm -rf ~/Library/Application\ Support/Mastisk
```

Your iCloud vault (the markdown) is preserved. Delete it manually if you want:
```bash
rm -rf ~/Library/Mobile\ Documents/com~apple~CloudDocs/Mastisk
```

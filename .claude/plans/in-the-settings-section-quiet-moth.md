# Visual harmony: Repos page in IngestView template

## Context

Subscriptions and Sources & ingest now share a consistent visual language:
`view-h` breadcrumb → `view-title` → `view-sub` → bordered list with ghost-button rows → toast notifications. The Repos page predates that template and stands out as the inconsistent one — different heading hierarchy, raw `<button>` row, no top-level `view-h` section header, and a free-form layout for the detail page.

**Outcome:** ReposView and RepoDetailView adopt the same template so the three "things you watch" sections (Sources & ingest, Subscriptions, Repos) feel visually unified. Backend and unique repo features (rolling context, ideas, local-path, GitHub PAT, ideate-now action) are untouched.

This is **purely a visual rewrite**. No backend changes, no API changes, no schema changes.

## Scope

**In:**
- `frontend/src/components/ReposView.tsx` — list page
- `frontend/src/components/RepoDetailView.tsx` — detail page

**Out:**
- AddRepoModal — already styled and works fine (don't fix what isn't broken)
- repos_route.py / queries.py / agents — unchanged
- Sidebar Repos row — already a sibling of Subscriptions (no change needed)
- Folding Repos into Subscriptions data model — explicitly rejected

## ReposView (list page)

Structure mirrors [SubscriptionsView](frontend/src/components/SubscriptionsView.tsx):

```tsx
<div className="view">
  <div className="view-h">System · Repos</div>
  <h1 className="view-title">Codebases your agents study.</h1>
  <p className="view-sub">
    GitHub Poller refreshes commits, issues, PRs, and README every hour.
    GitHub Ideator generates ~4 idea-notes per repo per day, which flow
    through the Notetaker into wiki articles. Add one below or via{' '}
    <code>mastisk add-repo &lt;slug&gt;</code>.
  </p>

  {/* Action bar: + add repo button (right-aligned, btnPrimary) */}

  <div className="view-h">Tracked repos · {N}</div>

  {/* Empty state: dashed-border card matching IngestView */}

  {/* Bordered single container, repo rows separated by line-soft */}
</div>
```

Each row uses the same grid-template-columns pattern as Subscriptions, with **three ghost-button actions**:

```
[icon] Repo display name                      [Poll now]  [Ideate now]  [Remove]
       owner/repo  ↗  (or local: /path)
       github · last polled · last ideated · ★ stars · private flag · error?
```

- Icon: `⎇` for GitHub, `📁` for local. Mono color.
- Click anywhere on the row body → navigate to detail.
- Status word at the right of the metadata row: `live` / `error` (no pause/resume — repos don't have an enabled toggle today; respect existing semantics).
- Reuses the same `inputStyle()`/`btnPrimary()`/`btnGhost()` helpers used by SubscriptionsView. Keep them as inline helpers in this file (matches IngestView; no need for a shared module).
- Toast for poll/ideate/remove actions matches IngestView.

## RepoDetailView

Structure mirrors [SubscriptionDetailView](frontend/src/components/SubscriptionDetailView.tsx) with one extra section for repo-specific features:

```tsx
<div className="view">
  <div className="view-h">
    <a onClick={…navigate('repos')}>System · Repos</a> · {github | local}
  </div>

  <h1 className="view-title">{display_name or slug}</h1>

  <p className="view-sub">
    {github URL link or local path} · last polled {ago} · last ideated {ago}
    {private ? ' · private' : ''}
  </p>

  {repo.description && <p style={{ fontFamily: 'var(--serif)' }}>…</p>}

  {/* Action bar: three ghost buttons */}
  [Poll now]  [Ideate now]  [Remove]

  {/* Rolling context — keep but rewrap with view-h section header */}
  <div className="view-h">Rolling context</div>
  {context_md
    ? <pre style={{ background: 'var(--bg-card)', border: '1px solid var(--line)', borderRadius: 8, … }}>
    : empty-state dashed-border card "Not yet polled. Hit Poll now…"}

  {/* Ideas — list rendered the same way Recent items renders on Subscriptions */}
  <div className="view-h">Ideas from this repo · {N}</div>
  {lastFailed && <error banner>}
  {ideas.length === 0
    ? empty-state dashed card with the existing helpful copy
    : bordered list container, each idea row:
        [classification badge] {summary or slug}              {date}
      Same row pattern as SubscriptionDetailView's RecentItemRow}

  {/* Details section — replaces the loose timestamps/strings */}
  <div className="view-h">Details</div>
  <dl> … 
    Source           github | local
    Slug             owner/repo  (or local path)
    Last polled      {timestamp}
    Last ideated     {timestamp}
    Visibility       public | private
    Ideation runs    {N}; last run model: {…}
  </dl>
</div>
```

Action buttons reuse the same helpers; "Ideate now" is the third button in place of Subscriptions' Pause/Resume since repos don't have an enabled toggle. Color-coded "remove" via `btnGhost('danger')`.

## Tokens to use (matching established conventions)

- Modal backgrounds: `var(--bg-elev)`
- Card / input fields / pre blocks: `var(--bg-card)`
- Borders: `var(--line)`; soft separators: `var(--line-soft)`
- Headings: `var(--fg)`; body: `var(--fg)`/`var(--fg-mute)`; faint: `var(--fg-faint)`
- Accent (orange): **only** for primary CTAs (`btnPrimary`). Never for success/info pills.
- Errors: `#c53030` boxed panels with `rgba(197,48,48,0.08)` background

## Files touched

| file | change |
|---|---|
| [frontend/src/components/ReposView.tsx](frontend/src/components/ReposView.tsx) | full rewrite; same component name + props; preserves `reloadKey`, `onAddRepo`, `onNavigate` interface |
| [frontend/src/components/RepoDetailView.tsx](frontend/src/components/RepoDetailView.tsx) | full rewrite; preserves `slug`, `onNavigate` props; preserves all data fetches (`api.repos.get`, `api.repos.ideas`) |

No other files change. No new dependencies. No new types. No backend touches.

## Verification

After build + reinstall + restart:

1. **Visual sibling test** — open Subscriptions, then Repos. The two pages should feel like siblings: same breadcrumb, title, subtitle pattern; same bordered row container; same button styling.
2. **Repos list** — kind icon (⎇ or 📁), three ghost buttons per row (Poll now / Ideate now / Remove), click row body → navigate to detail. Toast on action.
3. **Empty state** — if no repos, dashed-border card matching IngestView/Subscriptions.
4. **Repo detail** — breadcrumb back-link works; rolling context renders inside a properly themed `<pre>`; ideas list renders with classification badges and date column; last-failed banner if applicable; Details section as a `dl` key/value list at the bottom.
5. **Existing functionality preserved** — `Poll now`, `Ideate now`, `Remove` all hit the same APIs they used to. Confirm by triggering each on a real repo (`anthropics/claude-code` already tracked) and checking `mastisk logs -n 30` for the corresponding agent activity.
6. **Local repos** — tracking a local-git path (`local:/Users/gaurav/Documents/code/mastisk`) renders correctly with the 📁 icon and `local: /path` source.

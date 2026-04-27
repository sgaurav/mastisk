import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RepoSummary, View } from '../types';

interface Props {
  onNavigate: (view: View, id?: string) => void;
  onAddRepo: () => void;
  reloadKey?: number;
}

interface Toast { text: string; tone: 'ok' | 'err' | 'info' }

export function ReposView({ onNavigate, onAddRepo, reloadKey }: Props) {
  const [rows, setRows] = useState<RepoSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const reload = async () => {
    try {
      const d = await api.repos.list();
      setRows(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  };

  useEffect(() => { void reload(); }, [reloadKey]);

  const flash = (t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 2400);
  };

  const onPollNow = async (slug: string) => {
    try {
      await api.repos.pollNow(slug);
      flash({ text: 'polling now — watch the ticker', tone: 'ok' });
      setTimeout(() => void reload(), 4000);
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    }
  };

  const onIdeate = async (slug: string) => {
    try {
      await api.repos.ideateNow(slug);
      flash({ text: 'ideating now — watch the ticker', tone: 'ok' });
      setTimeout(() => void reload(), 4000);
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    }
  };

  const onRemove = async (slug: string, label: string) => {
    if (!confirm(`Stop tracking ${label}?\n\nHistorical snapshots and generated notes are kept.`)) return;
    try {
      await api.repos.delete(slug);
      await reload();
      flash({ text: 'removed', tone: 'info' });
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    }
  };

  if (err) return <div className="view"><p style={{ color: '#c53030' }}>{err}</p></div>;

  return (
    <div className="view">
      <div className="view-h">System · Repos</div>
      <h1 className="view-title">Codebases your agents study.</h1>
      <p className="view-sub">
        GitHub Poller refreshes commits, issues, PRs, and README every hour.
        GitHub Ideator generates ~4 idea-notes per repo per day, which flow
        through the Notetaker into wiki articles. Add one below or via{' '}
        <code style={{fontFamily:'var(--mono)',fontSize:12,background:'var(--bg-sunk)',padding:'1px 6px',borderRadius:4}}>mastisk add-repo &lt;slug&gt;</code>.
      </p>

      <div style={{display:'flex',gap:10,alignItems:'center',margin:'24px 0 24px',flexWrap:'wrap'}}>
        <div style={{flex:1}}/>
        <button onClick={onAddRepo} style={btnPrimary(false)}>+ Add repo</button>
      </div>

      <div className="view-h">Tracked repos {rows && `· ${rows.length}`}</div>

      {!rows && <p style={{color:'var(--fg-faint)',fontFamily:'var(--mono)',fontSize:12}}>loading…</p>}

      {rows && rows.length === 0 && (
        <div style={{padding:'24px',border:'1px dashed var(--line)',borderRadius:8,fontFamily:'var(--serif)',color:'var(--fg-mute)'}}>
          No repos tracked yet. Hit <strong>+ Add repo</strong> above.
          <div style={{marginTop:10,fontSize:13}}>
            Try <code>anthropics/claude-code</code> — pulls the README + recent commits + open issues.
            Private repos need a GitHub PAT in{' '}
            <a
              href="#settings"
              onClick={(e) => { e.preventDefault(); onNavigate('settings'); }}
              style={{color:'var(--accent)',textDecoration:'underline',cursor:'pointer'}}
            >Settings</a>.
          </div>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{border:'1px solid var(--line)',borderRadius:8,overflow:'hidden'}}>
          {rows.map((r) => (
            <RepoRow
              key={r.slug}
              repo={r}
              onOpen={() => onNavigate('repo', r.slug)}
              onPollNow={() => void onPollNow(r.slug)}
              onIdeate={() => void onIdeate(r.slug)}
              onRemove={() => void onRemove(r.slug, r.display_name ?? r.slug)}
            />
          ))}
        </div>
      )}

      {toast && (
        <div className="toast" style={{
          background: toast.tone === 'err' ? '#c53030' : toast.tone === 'ok' ? 'var(--fg)' : 'var(--bg-elev)',
          color: toast.tone === 'info' ? 'var(--fg)' : 'var(--fg-inv)',
          border: toast.tone === 'info' ? '1px solid var(--line)' : 'none',
        }}>{toast.text}</div>
      )}
    </div>
  );
}

function RepoRow({ repo, onOpen, onPollNow, onIdeate, onRemove }: {
  repo: RepoSummary;
  onOpen: () => void;
  onPollNow: () => void;
  onIdeate: () => void;
  onRemove: () => void;
}) {
  const isLocal = repo.source_type === 'local';
  const last = repo.last_polled_at ? timeAgo(repo.last_polled_at) : 'never';
  const status: 'live' | 'error' = repo.snapshot?.error ? 'error' : 'live';
  const sourceUrl = isLocal ? null : `https://github.com/${repo.slug}`;
  const subtitle = isLocal ? (repo.local_path || repo.slug) : repo.slug;
  return (
    <div style={{
      display:'grid',
      gridTemplateColumns:'1fr auto auto auto',
      gap:10,
      padding:'14px 16px',
      borderTop:'1px solid var(--line-soft)',
      alignItems:'center',
    }}>
      <div style={{overflow:'hidden',cursor:'pointer'}} onClick={onOpen}>
        <div style={{fontSize:14,color:'var(--fg)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          <span style={{marginRight:8,color:'var(--fg-faint)'}}>{isLocal ? '📁' : '⎇'}</span>
          {repo.display_name ?? repo.slug}
        </div>
        <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--fg-faint)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noreferrer" style={{color:'inherit'}} onClick={(e) => e.stopPropagation()}>
              {subtitle}
            </a>
          ) : subtitle}
        </div>
        <div style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--fg-faint)',marginTop:3}}>
          {isLocal ? 'local' : 'github'}
          <span style={{marginLeft:10}}>last polled: <span style={{color: repo.last_polled_at ? 'var(--fg-mute)' : 'var(--accent)'}}>{last}</span></span>
          {repo.last_ideated_at && <span style={{marginLeft:10}}>last ideated: {timeAgo(repo.last_ideated_at)}</span>}
          {repo.snapshot?.stars_count != null && <span style={{marginLeft:10}}>★ {repo.snapshot.stars_count}</span>}
          {repo.is_private && <span style={{marginLeft:10,color:'var(--accent)'}}>private</span>}
          {status === 'error' && (
            <span style={{marginLeft:10,color:'#c53030'}} title={repo.snapshot?.error || ''}>
              error
            </span>
          )}
        </div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onPollNow(); }} style={btnGhost()} title="Refresh commits, issues, PRs, README">
        Poll now
      </button>
      <button onClick={(e) => { e.stopPropagation(); onIdeate(); }} style={btnGhost()} title="Generate ~4 idea-notes from rolling context">
        Ideate now
      </button>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }} style={btnGhost('danger')} title="Stop tracking">
        Remove
      </button>
    </div>
  );
}

function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime();
  if (delta < 0) return 'just now';
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: '10px 18px',
    borderRadius: 6,
    background: disabled ? 'var(--bg-sunk)' : 'var(--accent)',
    color: disabled ? 'var(--fg-faint)' : 'var(--fg-inv)',
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none',
  };
}

function btnGhost(tone: 'normal' | 'danger' = 'normal'): React.CSSProperties {
  return {
    padding: '7px 12px',
    borderRadius: 5,
    background: 'transparent',
    color: tone === 'danger' ? 'var(--fg-mute)' : 'var(--fg)',
    fontSize: 12,
    border: '1px solid var(--line)',
    cursor: 'pointer',
  };
}

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { RepoDetail, RepoIdea, RepoIdeasResponse, View } from '../types';

interface Props {
  slug: string;
  onNavigate: (view: View, id?: string) => void;
}

interface Toast { text: string; tone: 'ok' | 'err' | 'info' }

export function RepoDetailView({ slug, onNavigate }: Props) {
  const [repo, setRepo] = useState<RepoDetail | null>(null);
  const [ideas, setIdeas] = useState<RepoIdeasResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'poll' | 'ideate' | 'remove' | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const load = useCallback(() => {
    api.repos.get(slug)
      .then(setRepo)
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
    api.repos.ideas(slug)
      .then(setIdeas)
      .catch(() => { /* non-fatal */ });
  }, [slug]);
  useEffect(load, [load]);

  const flash = (t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 2400);
  };

  const onPoll = async () => {
    setBusy('poll');
    try {
      await api.repos.pollNow(slug);
      flash({ text: 'polling now — watch the ticker', tone: 'ok' });
      setTimeout(() => { load(); setBusy(null); }, 1500);
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
      setBusy(null);
    }
  };

  const onIdeate = async () => {
    setBusy('ideate');
    try {
      await api.repos.ideateNow(slug);
      flash({ text: 'ideating now — watch the ticker', tone: 'ok' });
      setTimeout(() => { load(); setBusy(null); }, 1500);
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
      setBusy(null);
    }
  };

  const onRemove = async () => {
    if (!confirm(`Stop tracking ${slug}?\n\nHistorical snapshots and generated notes are kept.`)) return;
    setBusy('remove');
    try {
      await api.repos.delete(slug);
      onNavigate('repos');
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
      setBusy(null);
    }
  };

  if (err) return <div className="view"><p style={{ color: '#c53030' }}>{err}</p></div>;
  if (!repo) return <div className="view"><p style={{ color: 'var(--fg-faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>loading…</p></div>;

  const isLocal = repo.source_type === 'local';
  const sourceUrl = isLocal ? null : `https://github.com/${repo.slug}`;
  const lastPolled = repo.last_polled_at ? timeAgo(repo.last_polled_at) : 'never';

  return (
    <div className="view">
      <div className="view-h">
        <a
          href="#repos"
          onClick={(e) => { e.preventDefault(); onNavigate('repos'); }}
          style={{color:'inherit'}}
        >
          System · Repos
        </a>
        {' · '}
        {isLocal ? 'local' : 'github'}
      </div>

      <h1 className="view-title" style={{display:'flex',alignItems:'center',gap:10}}>
        <span style={{color:'var(--fg-faint)',fontSize:'0.7em'}}>{isLocal ? '📁' : '⎇'}</span>
        <span>{repo.display_name ?? repo.slug}</span>
      </h1>

      <p className="view-sub">
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noreferrer">{repo.slug}</a>
        ) : (
          <code style={{fontFamily:'var(--mono)',fontSize:13}}>{repo.local_path}</code>
        )}{' '}
        · last polled <span style={{color: repo.last_polled_at ? 'var(--fg-mute)' : 'var(--accent)'}}>{lastPolled}</span>
        {repo.last_ideated_at && <> · last ideated {timeAgo(repo.last_ideated_at)}</>}
        {repo.is_private && <> · <span style={{color:'var(--accent)'}}>private</span></>}
      </p>

      {repo.description && (
        <p style={{ fontFamily: 'var(--serif)', fontSize: 14, lineHeight: 1.55, color: 'var(--fg-mute)', marginTop: 8 }}>
          {repo.description}
        </p>
      )}

      <div style={{display:'flex',gap:8,margin:'24px 0 8px',flexWrap:'wrap'}}>
        <button onClick={() => void onPoll()} disabled={busy !== null} style={btnGhost()}>
          {busy === 'poll' ? 'polling…' : 'Poll now'}
        </button>
        <button onClick={() => void onIdeate()} disabled={busy !== null} style={btnGhost()}>
          {busy === 'ideate' ? 'ideating…' : 'Ideate now'}
        </button>
        <button onClick={() => void onRemove()} disabled={busy !== null} style={btnGhost('danger')}>
          Remove
        </button>
      </div>

      <div className="view-h" style={{marginTop:40}}>Rolling context</div>
      {repo.context_md ? (
        <pre style={{
          whiteSpace: 'pre-wrap',
          fontSize: 12,
          lineHeight: 1.55,
          fontFamily: 'var(--mono)',
          background: 'var(--bg-card)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: 14,
          margin: '14px 0 0',
          overflowX: 'auto',
        }}>
          {repo.context_md}
        </pre>
      ) : (
        <div style={{padding:'24px',border:'1px dashed var(--line)',borderRadius:8,fontFamily:'var(--serif)',color:'var(--fg-mute)'}}>
          Not yet polled. Hit <strong>Poll now</strong> above to fetch the latest commits,
          issues, PRs, and README.
        </div>
      )}

      <IdeasSection ideas={ideas} onNavigate={onNavigate} />

      <div className="view-h" style={{marginTop:48}}>Details</div>
      <dl style={{
        display:'grid',
        gridTemplateColumns:'180px 1fr',
        gap:'8px 16px',
        fontFamily:'var(--mono)',
        fontSize:12,
        color:'var(--fg-mute)',
        margin:'14px 0 0',
      }}>
        <dt style={{color:'var(--fg-faint)'}}>Source</dt>
        <dd style={{margin:0}}>{isLocal ? 'local' : 'github'}</dd>
        <dt style={{color:'var(--fg-faint)'}}>{isLocal ? 'Path' : 'Slug'}</dt>
        <dd style={{margin:0,wordBreak:'break-all'}}>{isLocal ? repo.local_path : repo.slug}</dd>
        {!isLocal && repo.default_branch && (
          <>
            <dt style={{color:'var(--fg-faint)'}}>Default branch</dt>
            <dd style={{margin:0}}>{repo.default_branch}</dd>
          </>
        )}
        <dt style={{color:'var(--fg-faint)'}}>Last polled</dt>
        <dd style={{margin:0}}>{repo.last_polled_at || '—'}</dd>
        <dt style={{color:'var(--fg-faint)'}}>Last ideated</dt>
        <dd style={{margin:0}}>{repo.last_ideated_at || '—'}</dd>
        <dt style={{color:'var(--fg-faint)'}}>Visibility</dt>
        <dd style={{margin:0}}>{repo.is_private ? 'private' : 'public'}</dd>
        <dt style={{color:'var(--fg-faint)'}}>Added</dt>
        <dd style={{margin:0}}>{repo.added_at}</dd>
      </dl>

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

function IdeasSection({
  ideas,
  onNavigate,
}: {
  ideas: RepoIdeasResponse | null;
  onNavigate: (view: View, id?: string) => void;
}) {
  if (!ideas) {
    return (
      <>
        <div className="view-h" style={{marginTop:40}}>Ideas from this repo</div>
        <p style={{color:'var(--fg-faint)',fontFamily:'var(--mono)',fontSize:12,marginTop:14}}>loading…</p>
      </>
    );
  }

  const lastFailed = ideas.runs.find((r) => r.error);

  return (
    <>
      <div className="view-h" style={{marginTop:40}}>
        Ideas from this repo {ideas.ideas.length > 0 && `· ${ideas.ideas.length}`}
      </div>

      {lastFailed && (
        <div style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 6,
          background: 'rgba(197,48,48,0.08)',
          border: '1px solid rgba(197,48,48,0.3)',
          fontFamily: 'var(--mono)',
          fontSize: 12,
          color: '#c53030',
        }}>
          last run errored @ {new Date(lastFailed.ideated_at).toLocaleString()}: {lastFailed.error}
        </div>
      )}

      {ideas.ideas.length === 0 ? (
        <div style={{padding:'24px',border:'1px dashed var(--line)',borderRadius:8,fontFamily:'var(--serif)',color:'var(--fg-mute)',marginTop:14}}>
          No ideas yet. They're generated from the rolling context on each ideation run and
          flow through the Notetaker. Hit <strong>Ideate now</strong> to trigger one immediately.
        </div>
      ) : (
        <div style={{border:'1px solid var(--line)',borderRadius:8,overflow:'hidden',marginTop:14}}>
          {ideas.ideas.map((n) => (
            <IdeaRow key={n.id} idea={n} onOpen={() => onNavigate('note', String(n.id))} />
          ))}
        </div>
      )}

      {ideas.runs.length > 0 && (
        <div style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--fg-faint)',marginTop:10}}>
          {ideas.runs.length} run{ideas.runs.length === 1 ? '' : 's'} tracked · last:{' '}
          {new Date(ideas.runs[0].ideated_at).toLocaleString()}
          {ideas.runs[0].model && ` · model=${ideas.runs[0].model}`}
        </div>
      )}
    </>
  );
}

function IdeaRow({ idea, onOpen }: { idea: RepoIdea; onOpen: () => void }) {
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 12,
        padding: '12px 16px',
        borderTop: '1px solid var(--line-soft)',
        alignItems: 'center',
        cursor: 'pointer',
      }}
    >
      {idea.classification ? (
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 10,
          color: 'var(--fg-mute)', textTransform: 'lowercase',
          border: '1px solid var(--line-soft)', borderRadius: 4,
          padding: '2px 6px',
        }}>
          {idea.classification}
        </span>
      ) : (
        <span style={{ width: 0 }} />
      )}
      <span style={{
        fontSize: 13, color: 'var(--fg)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {idea.summary ?? idea.slug}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-faint)' }}>
        {timeAgo(idea.created_at)}
      </span>
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

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { SubscriptionDetail, SubscriptionKind, SubscriptionRecentItem, View } from '../types';

interface Props {
  url: string;
  onNavigate: (view: View, id?: string) => void;
}

interface Toast { text: string; tone: 'ok' | 'err' | 'info' }

export function SubscriptionDetailView({ url, onNavigate }: Props) {
  const [data, setData] = useState<SubscriptionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'poll' | 'toggle' | 'remove' | 'title' | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.subscriptions.get(url);
      setData(d);
      setTitleDraft(d.subscription.title || '');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  const flash = (t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 2400);
  };

  const pollNow = async () => {
    setBusy('poll');
    try {
      await api.subscriptions.pollNow(url);
      flash({ text: 'polling now — watch the ticker', tone: 'ok' });
      setTimeout(() => { void load().finally(() => setBusy(null)); }, 1500);
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
      setBusy(null);
    }
  };

  const toggle = async () => {
    setBusy('toggle');
    try {
      await api.subscriptions.toggle(url);
      await load();
      flash({ text: data?.subscription.enabled ? 'paused' : 'resumed', tone: 'info' });
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm('Unsubscribe?\n\nPolling stops; existing wiki content is kept.')) return;
    setBusy('remove');
    try {
      await api.subscriptions.remove(url);
      onNavigate('subscriptions');
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
      setBusy(null);
    }
  };

  const saveTitle = async () => {
    setBusy('title');
    try {
      await api.subscriptions.update(url, { title: titleDraft });
      setEditingTitle(false);
      await load();
      flash({ text: 'title updated', tone: 'ok' });
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    } finally {
      setBusy(null);
    }
  };

  if (err) return <div className="view"><p style={{ color: '#c53030' }}>{err}</p></div>;
  if (!data) return <div className="view"><p style={{ color: 'var(--fg-faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>loading…</p></div>;

  const s = data.subscription;
  const status: 'live' | 'paused' | 'error' = !s.enabled ? 'paused' : s.last_error ? 'error' : 'live';
  const last = s.last_fetched ? timeAgo(s.last_fetched) : 'never';

  return (
    <div className="view">
      <div className="view-h">
        <a
          href="#subscriptions"
          onClick={(e) => { e.preventDefault(); onNavigate('subscriptions'); }}
          style={{color:'inherit'}}
        >
          System · Subscriptions
        </a>
        {' · '}
        {kindLabel(s.kind)}
      </div>

      {editingTitle ? (
        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void saveTitle(); }}
            disabled={busy === 'title'}
            autoFocus
            style={{
              flex:1, padding:'10px 12px', borderRadius:6,
              background:'var(--bg-card)', color:'var(--fg)',
              border:'1px solid var(--line)', fontSize:24, fontFamily:'var(--serif)', fontWeight:500,
            }}
          />
          <button onClick={() => void saveTitle()} disabled={busy === 'title'} style={btnPrimary(busy === 'title')}>save</button>
          <button onClick={() => { setEditingTitle(false); setTitleDraft(s.title || ''); }} disabled={busy === 'title'} style={btnGhost()}>cancel</button>
        </div>
      ) : (
        <h1 className="view-title" style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{color:'var(--fg-faint)',fontSize:'0.7em'}}>{kindIcon(s.kind)}</span>
          <span>{s.title || s.url}</span>
          <button
            onClick={() => setEditingTitle(true)}
            title="Edit title"
            style={{background:'transparent',border:'none',color:'var(--fg-faint)',cursor:'pointer',fontSize:14}}
          >✎</button>
        </h1>
      )}

      <p className="view-sub">
        {s.source_url ? (
          <a href={s.source_url} target="_blank" rel="noreferrer">{s.source_url}</a>
        ) : (
          s.url
        )}{' '}
        · last polled <span style={{color: s.last_fetched ? 'var(--fg-mute)' : 'var(--accent)'}}>{last}</span>
        {' · '}
        <span style={{
          color: status === 'error' ? '#c53030' : status === 'paused' ? 'var(--accent)' : 'var(--fg-mute)',
        }}>
          {status}
        </span>
      </p>

      <div style={{display:'flex',gap:8,margin:'24px 0 8px',flexWrap:'wrap'}}>
        <button onClick={() => void pollNow()} disabled={busy !== null} style={btnGhost()}>
          {busy === 'poll' ? 'polling…' : 'Poll now'}
        </button>
        <button onClick={() => void toggle()} disabled={busy !== null} style={btnGhost()}>
          {s.enabled ? 'Pause' : 'Resume'}
        </button>
        <button onClick={() => void remove()} disabled={busy !== null} style={btnGhost('danger')}>
          Remove
        </button>
      </div>

      {s.last_error && (
        <div style={{
          padding:12, marginTop:14, borderRadius:6,
          background:'rgba(197,48,48,0.08)', border:'1px solid rgba(197,48,48,0.3)',
          fontFamily:'var(--mono)', fontSize:12, color:'#c53030',
        }}>
          last poll error: {s.last_error}
        </div>
      )}

      <div className="view-h" style={{marginTop:40}}>
        Recent items {data.recent_items.length > 0 && `· ${data.recent_items.length}`}
      </div>

      {data.recent_items.length === 0 ? (
        <div style={{padding:'24px',border:'1px dashed var(--line)',borderRadius:8,fontFamily:'var(--serif)',color:'var(--fg-mute)'}}>
          Nothing here yet. Hit <strong>Poll now</strong> above to fetch the latest items.
        </div>
      ) : (
        <div style={{border:'1px solid var(--line)',borderRadius:8,overflow:'hidden'}}>
          {data.recent_items.map((it) => (
            <RecentItemRow key={it.id} item={it} />
          ))}
        </div>
      )}

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
        <dt style={{color:'var(--fg-faint)'}}>Feed URL</dt>
        <dd style={{margin:0,wordBreak:'break-all'}}>{s.url}</dd>
        <dt style={{color:'var(--fg-faint)'}}>Last seen GUID</dt>
        <dd style={{margin:0}}>{s.last_seen_guid || '—'}</dd>
        <dt style={{color:'var(--fg-faint)'}}>Backfill remaining</dt>
        <dd style={{margin:0}}>{s.backfill_remaining}</dd>
        <dt style={{color:'var(--fg-faint)'}}>Max per poll</dt>
        <dd style={{margin:0}}>{s.max_per_poll}</dd>
        <dt style={{color:'var(--fg-faint)'}}>Bypass interest filter</dt>
        <dd style={{margin:0}}>{s.bypass_interest_gate ? 'yes' : 'no'}</dd>
        <dt style={{color:'var(--fg-faint)'}}>Added</dt>
        <dd style={{margin:0}}>{s.added_at}</dd>
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

function RecentItemRow({ item }: { item: SubscriptionRecentItem }) {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(item.payload_json); } catch { /* swallow */ }
  const title = (payload.episode_title as string)
    || (payload.url as string)
    || (payload.audio_url as string)
    || `${item.agent}/${item.kind}`;
  const statusBadge = item.status === 'done' ? '✓'
    : item.status === 'failed' ? '⚠'
    : item.status === 'running' ? '◌'
    : '⏳';
  const color = item.status === 'failed' ? '#c53030'
    : item.status === 'done' ? 'var(--fg)'
    : 'var(--fg-mute)';
  return (
    <div style={{
      display:'grid',
      gridTemplateColumns:'24px 1fr auto',
      gap:10,
      padding:'12px 16px',
      borderTop:'1px solid var(--line-soft)',
      alignItems:'center',
    }}>
      <span style={{color, fontFamily:'var(--mono)', textAlign:'center'}}>{statusBadge}</span>
      <div style={{overflow:'hidden'}}>
        <div style={{fontSize:13,color,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {title}
        </div>
        <div style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--fg-faint)',marginTop:2}}>
          {item.agent}/{item.kind} · {item.created_at}
          {item.error && (
            <span title={item.error} style={{color:'#c53030',marginLeft:8}}>
              · {item.error.slice(0, 80)}
            </span>
          )}
        </div>
      </div>
      <span style={{
        fontFamily:'var(--mono)', fontSize:10,
        color:'var(--fg-faint)', textTransform:'uppercase', letterSpacing:'0.04em',
      }}>
        {item.status}
      </span>
    </div>
  );
}

function kindIcon(k: SubscriptionKind): string {
  if (k === 'youtube') return '▶';
  if (k === 'podcast') return '🎙';
  return '◊';
}
function kindLabel(k: SubscriptionKind): string {
  if (k === 'youtube') return 'YouTube';
  if (k === 'podcast') return 'Podcast';
  return 'RSS';
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

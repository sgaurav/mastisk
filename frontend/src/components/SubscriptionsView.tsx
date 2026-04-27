import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Subscription, SubscriptionKind, View } from '../types';

interface Props {
  onNavigate: (view: View, id?: string) => void;
  onAddSubscription: () => void;
  reloadKey?: number;
}

interface Toast { text: string; tone: 'ok' | 'err' | 'info' }
type Filter = 'all' | SubscriptionKind;

export function SubscriptionsView({ onNavigate, onAddSubscription, reloadKey }: Props) {
  const [rows, setRows] = useState<Subscription[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [toast, setToast] = useState<Toast | null>(null);

  const reload = async () => {
    try {
      const d = await api.subscriptions.list();
      setRows(d.subscriptions);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  };

  useEffect(() => { void reload(); }, [reloadKey]);

  const flash = (t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 2400);
  };

  const onPollNow = async (url: string) => {
    try {
      await api.subscriptions.pollNow(url);
      flash({ text: 'polling now — watch the ticker', tone: 'ok' });
      setTimeout(() => void reload(), 4000);
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    }
  };

  const onToggle = async (url: string, enabled: boolean) => {
    try {
      await api.subscriptions.toggle(url);
      await reload();
      flash({ text: enabled ? 'paused' : 'resumed', tone: 'info' });
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    }
  };

  const onRemove = async (url: string, title: string) => {
    if (!confirm(`Unsubscribe from\n${title || url}?\n\nPolling stops; existing wiki content is kept.`)) return;
    try {
      await api.subscriptions.remove(url);
      await reload();
      flash({ text: 'removed', tone: 'info' });
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    }
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (filter === 'all') return rows;
    return rows.filter((r) => r.kind === filter);
  }, [rows, filter]);

  if (err) return <div className="view"><p style={{ color: '#c53030' }}>{err}</p></div>;

  return (
    <div className="view">
      <div className="view-h">System · Subscriptions</div>
      <h1 className="view-title">Sources your agents watch.</h1>
      <p className="view-sub">
        Scout polls each subscription every 10 minutes. New blog posts go to Compiler;
        new YouTube videos and podcast episodes go to Listener for transcription. Add one
        below, via the <strong>+</strong> in the sidebar, or via{' '}
        <code style={{fontFamily:'var(--mono)',fontSize:12,background:'var(--bg-sunk)',padding:'1px 6px',borderRadius:4}}>mastisk subscribe &lt;url&gt;</code>.
      </p>

      <div style={{display:'flex',gap:10,alignItems:'center',margin:'24px 0 24px',flexWrap:'wrap'}}>
        {rows && rows.length > 0 && <FilterPills filter={filter} setFilter={setFilter} rows={rows}/>}
        <div style={{flex:1}}/>
        <button onClick={onAddSubscription} style={btnPrimary(false)}>+ Add subscription</button>
      </div>

      <div className="view-h">Subscribed sources {rows && `· ${rows.length}`}</div>

      {!rows && <p style={{color:'var(--fg-faint)',fontFamily:'var(--mono)',fontSize:12}}>loading…</p>}

      {rows && rows.length === 0 && (
        <div style={{padding:'24px',border:'1px dashed var(--line)',borderRadius:8,fontFamily:'var(--serif)',color:'var(--fg-mute)'}}>
          No subscriptions yet. Hit <strong>+ Add subscription</strong> above.
          <div style={{marginTop:10,fontSize:13}}>
            Try a YouTube channel like <code>youtube.com/@mkbhd</code>, an Apple Podcasts URL,
            or a podcast/blog RSS feed. Mastisk auto-detects the kind.
          </div>
        </div>
      )}

      {rows && rows.length > 0 && filtered.length === 0 && (
        <p style={{color:'var(--fg-mute)',fontFamily:'var(--serif)',padding:'16px 0'}}>
          No subscriptions match this filter.
        </p>
      )}

      {filtered.length > 0 && (
        <div style={{border:'1px solid var(--line)',borderRadius:8,overflow:'hidden'}}>
          {filtered.map((r) => (
            <SubscriptionRow
              key={r.url}
              sub={r}
              onOpen={() => onNavigate('subscription', r.url)}
              onPollNow={() => void onPollNow(r.url)}
              onToggle={() => void onToggle(r.url, r.enabled)}
              onRemove={() => void onRemove(r.url, r.title || '')}
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

function SubscriptionRow({ sub, onOpen, onPollNow, onToggle, onRemove }: {
  sub: Subscription;
  onOpen: () => void;
  onPollNow: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const last = sub.last_fetched ? timeAgo(sub.last_fetched) : 'never';
  const status: 'live' | 'paused' | 'error' = !sub.enabled
    ? 'paused'
    : sub.last_error ? 'error' : 'live';
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
          <span style={{marginRight:8,color:'var(--fg-faint)'}}>{kindIcon(sub.kind)}</span>
          {sub.title || sub.url}
        </div>
        <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--fg-faint)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {sub.source_url ? (
            <a href={sub.source_url} target="_blank" rel="noreferrer" style={{color:'inherit'}} onClick={(e) => e.stopPropagation()}>
              {sub.source_url}
            </a>
          ) : sub.url}
        </div>
        <div style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--fg-faint)',marginTop:3}}>
          {kindLabel(sub.kind)}
          <span style={{marginLeft:10}}>last polled: <span style={{color: sub.last_fetched ? 'var(--fg-mute)' : 'var(--accent)'}}>{last}</span></span>
          {sub.items_24h > 0 && <span style={{marginLeft:10}}>{sub.items_24h} new today</span>}
          {status === 'paused' && <span style={{marginLeft:10,color:'var(--accent)'}}>paused</span>}
          {status === 'error' && (
            <span style={{marginLeft:10,color:'#c53030'}} title={sub.last_error || ''}>
              error
            </span>
          )}
        </div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onPollNow(); }} style={btnGhost()} title="Poll this subscription right now">
        Poll now
      </button>
      <button onClick={(e) => { e.stopPropagation(); onToggle(); }} style={btnGhost()} title={sub.enabled ? 'Pause polling' : 'Resume polling'}>
        {sub.enabled ? 'Pause' : 'Resume'}
      </button>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }} style={btnGhost('danger')} title="Unsubscribe">
        Remove
      </button>
    </div>
  );
}

function FilterPills({ filter, setFilter, rows }: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  rows: Subscription[];
}) {
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, rss: 0, youtube: 0, podcast: 0 };
    for (const r of rows) c[r.kind] += 1;
    return c;
  }, [rows]);
  const Pill = ({ k, label }: { k: Filter; label: string }) => (
    <button
      onClick={() => setFilter(k)}
      style={{
        padding: '6px 12px', borderRadius: 999,
        border: '1px solid var(--line)',
        background: filter === k ? 'var(--bg-sunk)' : 'transparent',
        color: filter === k ? 'var(--fg)' : 'var(--fg-mute)',
        fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
      }}
    >
      {label} <span style={{ opacity: 0.6, marginLeft: 4 }}>{counts[k]}</span>
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <Pill k="all" label="all" />
      <Pill k="rss" label="RSS" />
      <Pill k="youtube" label="YouTube" />
      <Pill k="podcast" label="Podcast" />
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

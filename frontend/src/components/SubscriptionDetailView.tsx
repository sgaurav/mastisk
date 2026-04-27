import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { SubscriptionDetail, SubscriptionKind, SubscriptionRecentItem, View } from '../types';

interface Props {
  url: string;
  onNavigate: (view: View, id?: string) => void;
}

export function SubscriptionDetailView({ url, onNavigate }: Props) {
  const [data, setData] = useState<SubscriptionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'poll' | 'toggle' | 'remove' | 'title' | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showDetails, setShowDetails] = useState(false);

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

  const pollNow = async () => {
    setBusy('poll');
    try {
      await api.subscriptions.pollNow(url);
      // The poll runs in the background; reload after a short delay so the
      // recent_items list shows new queued jobs.
      setTimeout(() => { void load().finally(() => setBusy(null)); }, 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
      setBusy(null);
    }
  };

  const toggle = async () => {
    setBusy('toggle');
    try {
      await api.subscriptions.toggle(url);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm('Remove this subscription? Polling stops; existing wiki content is kept.')) return;
    setBusy('remove');
    try {
      await api.subscriptions.remove(url);
      onNavigate('subscriptions');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
      setBusy(null);
    }
  };

  const saveTitle = async () => {
    setBusy('title');
    try {
      await api.subscriptions.update(url, { title: titleDraft });
      setEditingTitle(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(null);
    }
  };

  if (err) return <div className="view"><p style={{ color: 'var(--danger, crimson)' }}>{err}</p></div>;
  if (!data) return <div className="view"><p style={{ color: 'var(--fg-faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>loading…</p></div>;

  const s = data.subscription;
  const status: 'live' | 'paused' | 'error' = !s.enabled ? 'paused'
    : s.last_error ? 'error' : 'live';
  const statusColor = status === 'error' ? 'var(--danger, crimson)'
    : status === 'paused' ? 'var(--fg-faint)' : 'var(--accent, #0a7)';

  return (
    <div className="view">
      <div className="view-h">
        <a href="#subscriptions" onClick={(e) => { e.preventDefault(); onNavigate('subscriptions'); }}>
          ← Subscriptions
        </a>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{kindIcon(s.kind)}</span>
        {editingTitle ? (
          <>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveTitle(); }}
              disabled={busy === 'title'}
              style={{
                fontSize: 18, padding: '4px 8px', flex: 1,
                background: 'transparent', color: 'var(--fg)',
                border: '1px solid var(--border, var(--line))', borderRadius: 4,
              }}
              autoFocus
            />
            <button onClick={() => void saveTitle()} disabled={busy === 'title'}>save</button>
            <button onClick={() => { setEditingTitle(false); setTitleDraft(s.title || ''); }} disabled={busy === 'title'}>cancel</button>
          </>
        ) : (
          <>
            <h1 className="view-title" style={{ margin: 0 }}>{s.title || s.url}</h1>
            <button
              onClick={() => setEditingTitle(true)}
              title="Edit title"
              style={{ background: 'transparent', border: 'none', color: 'var(--fg-faint)', cursor: 'pointer', fontSize: 14 }}
            >
              ✎
            </button>
          </>
        )}
      </div>

      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-faint)', marginBottom: 14 }}>
        {kindLabel(s.kind)} ·{' '}
        {s.source_url ? (
          <a href={s.source_url} target="_blank" rel="noopener noreferrer">
            {s.source_url}
          </a>
        ) : s.url}{' '}
        · last poll {s.last_fetched ? timeAgo(s.last_fetched) : '—'}
        <span style={{
          marginLeft: 12, color: statusColor, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {status}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => void pollNow()} disabled={busy !== null}>
          {busy === 'poll' ? 'polling…' : 'Poll now'}
        </button>
        <button onClick={() => void toggle()} disabled={busy !== null}>
          {s.enabled ? 'Pause' : 'Resume'}
        </button>
        <button onClick={() => void remove()} disabled={busy !== null} style={{ color: 'var(--danger, crimson)' }}>
          Remove
        </button>
      </div>

      {s.last_error && (
        <div style={{
          padding: 10, marginBottom: 14, borderRadius: 4,
          background: 'rgba(220,53,69,0.08)', border: '1px solid rgba(220,53,69,0.3)',
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--danger, crimson)',
        }}>
          last poll error: {s.last_error}
        </div>
      )}

      <h2 className="view-sub-title" style={{ marginTop: 8, marginBottom: 8 }}>
        Recent items {data.recent_items.length > 0 && <span style={{ color: 'var(--fg-faint)', fontWeight: 400 }}>({data.recent_items.length})</span>}
      </h2>
      {data.recent_items.length === 0 ? (
        <p className="view-sub" style={{ fontSize: 12 }}>
          Nothing yet. Hit “Poll now” to fetch the latest items.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.recent_items.map((it) => (
            <RecentItemRow key={it.id} item={it} />
          ))}
        </div>
      )}

      <div style={{ marginTop: 22, fontSize: 12 }}>
        <button
          onClick={() => setShowDetails((x) => !x)}
          style={{ background: 'transparent', border: 'none', color: 'var(--fg-mute)', cursor: 'pointer', padding: 0 }}
        >
          {showDetails ? '▾' : '▸'} Details
        </button>
        {showDetails && (
          <div style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-faint)', lineHeight: 1.7 }}>
            <div>Feed URL: {s.url}</div>
            <div>Last seen GUID: {s.last_seen_guid || '—'}</div>
            <div>Backfill remaining: {s.backfill_remaining}</div>
            <div>Max per poll: {s.max_per_poll}</div>
            <div>Bypass interest filter: {s.bypass_interest_gate ? 'yes' : 'no'}</div>
            <div>Added: {s.added_at}</div>
          </div>
        )}
      </div>
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
  const color = item.status === 'failed' ? 'var(--danger, crimson)'
    : item.status === 'done' ? 'var(--fg)'
    : 'var(--fg-mute)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
      <span style={{ color, fontFamily: 'var(--mono)', width: 16, textAlign: 'center' }}>{statusBadge}</span>
      <span style={{ flex: 1, color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title}
      </span>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-faint)' }}>
        {item.agent}/{item.kind}
        {item.error && (
          <span title={item.error} style={{ color: 'var(--danger, crimson)', marginLeft: 6 }}>
            error
          </span>
        )}
      </span>
    </div>
  );
}

function kindIcon(k: SubscriptionKind): string {
  if (k === 'youtube') return '▶';
  if (k === 'podcast') return '🎙';
  return '📰';
}
function kindLabel(k: SubscriptionKind): string {
  if (k === 'youtube') return 'YouTube';
  if (k === 'podcast') return 'Podcast';
  return 'RSS';
}
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(ms)) return iso;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

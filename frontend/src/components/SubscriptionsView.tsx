import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Subscription, SubscriptionKind, View } from '../types';

interface Props {
  onNavigate: (view: View, id?: string) => void;
  onAddSubscription: () => void;
  reloadKey?: number;
}

type Filter = 'all' | SubscriptionKind;

export function SubscriptionsView({ onNavigate, onAddSubscription, reloadKey }: Props) {
  const [rows, setRows] = useState<Subscription[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    api.subscriptions.list()
      .then((d) => setRows(d.subscriptions))
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [reloadKey]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (filter === 'all') return rows;
    return rows.filter((r) => r.kind === filter);
  }, [rows, filter]);

  if (err) return <div className="view"><p style={{ color: 'var(--danger, crimson)' }}>{err}</p></div>;
  if (!rows) return <div className="view"><p style={{ color: 'var(--fg-faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>loading…</p></div>;

  const isEmpty = rows.length === 0;

  return (
    <div className="view">
      <div className="view-h">Subscriptions</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 className="view-title" style={{ margin: 0 }}>
          {rows.length} subscription{rows.length === 1 ? '' : 's'}
        </h1>
        {!isEmpty && (
          <>
            <FilterPills filter={filter} setFilter={setFilter} rows={rows} />
            <div style={{ flex: 1 }} />
            <button onClick={onAddSubscription}>+ add</button>
          </>
        )}
      </div>

      {isEmpty && (
        <div style={{ marginTop: 8 }}>
          <p className="view-sub" style={{ marginBottom: 12 }}>
            Subscribe to keep up. Paste a YouTube channel, podcast, or RSS feed and Mastisk will process new uploads automatically.
          </p>
          <button
            onClick={onAddSubscription}
            style={{
              padding: '10px 18px', fontSize: 14, fontWeight: 600,
              background: 'var(--accent, #0a7)', color: 'var(--bg, white)',
              border: '1px solid var(--accent, #0a7)', borderRadius: 6, cursor: 'pointer',
            }}
          >
            + add your first subscription
          </button>
          <p className="view-sub" style={{ marginTop: 12, fontSize: 11 }}>
            Or run <code>mastisk subscribe &lt;url&gt;</code> from the CLI.
          </p>
        </div>
      )}

      {!isEmpty && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          {filtered.map((r) => (
            <SubscriptionRow key={r.url} sub={r} onNavigate={onNavigate} />
          ))}
          {filtered.length === 0 && (
            <p className="view-sub">no subscriptions match this filter</p>
          )}
        </div>
      )}
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
        padding: '4px 10px', borderRadius: 999,
        border: '1px solid var(--border, var(--line))',
        background: filter === k ? 'var(--accent-soft, var(--bg-sunk))' : 'transparent',
        color: filter === k ? 'var(--accent, var(--fg))' : 'var(--fg-mute)',
        fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
      }}
    >
      {label} <span style={{ opacity: 0.6 }}>{counts[k]}</span>
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

function SubscriptionRow({ sub, onNavigate }: {
  sub: Subscription;
  onNavigate: (view: View, id?: string) => void;
}) {
  const status: 'live' | 'paused' | 'error' = !sub.enabled
    ? 'paused'
    : sub.last_error ? 'error' : 'live';
  const statusColor = status === 'error' ? 'var(--danger, crimson)'
    : status === 'paused' ? 'var(--fg-faint)'
    : 'var(--accent, #0a7)';
  return (
    <button
      onClick={() => onNavigate('subscription', sub.url)}
      style={{
        textAlign: 'left', padding: 10,
        border: '1px solid var(--border, var(--line))', borderRadius: 6,
        background: 'var(--bg-soft, transparent)', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{kindIcon(sub.kind)}</span>
        <span style={{ fontWeight: 500 }}>{sub.title || sub.url}</span>
        <span style={{
          marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10,
          color: statusColor, textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {status}
        </span>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-faint)', marginTop: 4 }}>
        {sub.source_url || sub.url}
        {sub.last_fetched && <> · polled {timeAgo(sub.last_fetched)}</>}
        {sub.items_24h > 0 && <> · {sub.items_24h} new today</>}
        {sub.last_error && (
          <> · <span style={{ color: 'var(--danger, crimson)' }} title={sub.last_error}>{sub.last_error.slice(0, 60)}</span></>
        )}
      </div>
    </button>
  );
}

function kindIcon(k: SubscriptionKind): string {
  if (k === 'youtube') return '▶';
  if (k === 'podcast') return '🎙';
  return '📰';
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

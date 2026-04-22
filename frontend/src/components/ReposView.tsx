import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RepoSummary, View } from '../types';

interface Props {
  onNavigate: (view: View, id?: string) => void;
}

export function ReposView({ onNavigate }: Props) {
  const [rows, setRows] = useState<RepoSummary[] | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = () => {
    api.repos.list()
      .then(setRows)
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  };
  useEffect(reload, []);

  if (err) return <div className="view"><p style={{ color: 'var(--danger, crimson)' }}>{err}</p></div>;
  if (!rows) return <div className="view"><p style={{ color: 'var(--fg-faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>loading…</p></div>;

  return (
    <div className="view">
      <div className="view-h">Repos</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h1 className="view-title" style={{ margin: 0 }}>
          {rows.length} repo{rows.length === 1 ? '' : 's'}
        </h1>
        <button onClick={() => setAddOpen(true)}>+ add repo</button>
      </div>

      {rows.length === 0 && (
        <p className="view-sub">
          Track a GitHub repo and mastisk will poll it hourly, build rolling context, and generate 4 idea-notes per repo per day.
          Click "+ add repo" or run <code>mastisk add-repo owner/name</code>.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {rows.map((r) => (
          <button
            key={r.slug}
            onClick={() => onNavigate('repo', r.slug)}
            style={{
              textAlign: 'left', padding: 10,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-soft, transparent)', cursor: 'pointer',
            }}
          >
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-faint)' }}>
              {r.slug}
              {r.snapshot?.stars_count !== null && r.snapshot?.stars_count !== undefined && (
                <> · ★ {r.snapshot.stars_count}</>
              )}
              {r.last_polled_at && <> · polled {new Date(r.last_polled_at).toLocaleString()}</>}
              {r.snapshot?.error && <> · <span style={{ color: 'var(--danger, crimson)' }}>{r.snapshot.error}</span></>}
            </div>
            {r.description && <div style={{ fontSize: 13, marginTop: 4 }}>{r.description}</div>}
          </button>
        ))}
      </div>

      {addOpen && (
        <AddRepoModal
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); reload(); }}
        />
      )}
    </div>
  );
}


function AddRepoModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = slug.trim();
    if (!trimmed || !trimmed.includes('/')) {
      setError('expected owner/repo');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.repos.add(trimmed);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '10vh', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 16, width: 'min(440px, 92vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 12, color: 'var(--fg-faint)', marginBottom: 8, fontFamily: 'var(--mono)' }}>
          add a GitHub repo
        </div>
        <input
          autoFocus
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') onClose(); }}
          disabled={busy}
          placeholder="owner/repo"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'transparent', color: 'var(--fg)',
            border: '1px solid var(--border)', borderRadius: 4,
            padding: 8, fontFamily: 'var(--mono)', fontSize: 14,
          }}
        />
        {error && <div style={{ color: 'var(--danger, crimson)', marginTop: 6, fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          <button onClick={onClose} disabled={busy}>cancel</button>
          <button onClick={submit} disabled={busy || !slug.trim()}>{busy ? 'verifying…' : 'add'}</button>
        </div>
      </div>
    </div>
  );
}

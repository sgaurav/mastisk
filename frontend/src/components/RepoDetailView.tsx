import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { RepoDetail, View } from '../types';

interface Props {
  slug: string;
  onNavigate: (view: View, id?: string) => void;
}

export function RepoDetailView({ slug, onNavigate }: Props) {
  const [repo, setRepo] = useState<RepoDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setRepo(null);
    api.repos.get(slug)
      .then(setRepo)
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [slug]);
  useEffect(load, [load]);

  const onPoll = async () => {
    setBusy('poll');
    try { await api.repos.pollNow(slug); setTimeout(load, 1500); }
    catch (e) { setErr(e instanceof Error ? e.message : 'poll failed'); }
    finally { setBusy(null); }
  };
  const onIdeate = async () => {
    setBusy('ideate');
    try { await api.repos.ideateNow(slug); setTimeout(load, 1500); }
    catch (e) { setErr(e instanceof Error ? e.message : 'ideate failed'); }
    finally { setBusy(null); }
  };
  const onDelete = async () => {
    if (!confirm(`Stop tracking ${slug}? Historical snapshots and generated notes are kept.`)) return;
    try {
      await api.repos.delete(slug);
      onNavigate('repos');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    }
  };

  if (err) return <div className="view"><p style={{ color: 'var(--danger, crimson)' }}>{err}</p></div>;
  if (!repo) return <div className="view"><p style={{ color: 'var(--fg-faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>loading…</p></div>;

  return (
    <div className="view">
      <div className="view-h">Repo</div>
      <h1 className="view-title">{repo.display_name ?? repo.slug}</h1>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-faint)', marginBottom: 12 }}>
        {repo.slug}
        {repo.last_polled_at && <> · polled {new Date(repo.last_polled_at).toLocaleString()}</>}
        {repo.last_ideated_at && <> · ideated {new Date(repo.last_ideated_at).toLocaleString()}</>}
        {repo.is_private && <> · <strong>private</strong></>}
      </div>

      {repo.description && <p>{repo.description}</p>}

      <section style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 13, color: 'var(--fg-faint)', marginBottom: 8, fontFamily: 'var(--mono)' }}>
          Rolling context
        </h3>
        {repo.context_md ? (
          <pre style={{
            whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5,
            background: 'var(--bg-soft, transparent)',
            border: '1px solid var(--border)', borderRadius: 6, padding: 12,
          }}>
            {repo.context_md}
          </pre>
        ) : (
          <p style={{ color: 'var(--fg-faint)', fontSize: 12 }}>
            Not yet polled. Hit "poll now" to trigger immediately.
          </p>
        )}
      </section>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button onClick={() => onNavigate('repos')}>← all repos</button>
        <button onClick={onPoll} disabled={busy === 'poll'}>
          {busy === 'poll' ? 'polling…' : 'poll now'}
        </button>
        <button onClick={onIdeate} disabled={busy === 'ideate'}>
          {busy === 'ideate' ? 'ideating…' : 'ideate now'}
        </button>
        <button onClick={onDelete} style={{ marginLeft: 'auto' }}>remove</button>
      </div>
    </div>
  );
}

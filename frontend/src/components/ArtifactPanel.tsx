import { useCallback, useEffect, useState } from 'react';
import type { Article, Artifact } from '../types';
import { api } from '../api';
import { ArtifactCard } from './ArtifactCard';

interface Props {
  article: Article;
}

export function ArtifactPanel({ article }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.artifacts(article.id);
      setArtifacts(Array.isArray(r.artifacts) ? r.artifacts : []);
      setError(null);
    } catch (e) {
      setArtifacts([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [article.id]);

  useEffect(() => {
    setArtifacts(null);
    setError(null);
    setQueued(false);
    void load();
  }, [article.id, load]);

  const onRegenerate = async () => {
    if (regenBusy) return;
    setRegenBusy(true);
    try {
      await api.regenerateArtifacts(article.id);
      setQueued(true);
      window.setTimeout(() => setQueued(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenBusy(false);
    }
  };

  const onUpdated = (next: Artifact) => {
    setArtifacts((prev) => (prev ? prev.map((a) => (a.id === next.id ? next : a)) : prev));
  };

  const onDeleted = (id: number) => {
    setArtifacts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
  };

  return (
    <div className="rail-section artifact-panel">
      <div className="rail-h">
        <span>
          Artifacts{' '}
          {artifacts && artifacts.length > 0 && (
            <span className="count">{artifacts.length}</span>
          )}
        </span>
        <button
          type="button"
          className="artifact-regen"
          onClick={onRegenerate}
          disabled={regenBusy}
          title="Regenerate artifacts"
        >
          {queued ? 'Queued' : regenBusy ? '…' : '＋ Regenerate'}
        </button>
      </div>

      {artifacts === null && !error && (
        <div className="artifact-empty">Loading…</div>
      )}

      {error && (
        <div className="artifact-error">Couldn’t load artifacts. {error}</div>
      )}

      {artifacts !== null && artifacts.length === 0 && !error && (
        <div className="artifact-empty">
          No artifacts yet. Click regenerate to queue some.
        </div>
      )}

      {artifacts !== null && artifacts.length > 0 && (
        <div className="artifact-list">
          {artifacts.map((a) => (
            <ArtifactCard
              key={a.id}
              artifact={a}
              onUpdated={onUpdated}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}

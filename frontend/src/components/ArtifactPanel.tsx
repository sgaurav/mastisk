import { useCallback, useEffect, useRef, useState } from 'react';
import type { Article, Artifact } from '../types';
import { api } from '../api';
import { ArtifactCard } from './ArtifactCard';

interface Props {
  article: Article;
}

type JobStatus = 'queued' | 'running' | 'done' | 'failed';

const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // give up after 10 min

export function ArtifactPanel({ article }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const pollStart = useRef<number>(0);

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
    setJobId(null);
    setJobStatus(null);
    void load();
  }, [article.id, load]);

  // Poll the active regenerate job until it finishes. Stops itself on
  // done/failed/timeout and is aborted when article.id changes or the
  // component unmounts.
  useEffect(() => {
    if (jobId === null) return;
    let cancelled = false;
    pollStart.current = Date.now();

    const tick = async () => {
      if (cancelled) return;
      try {
        const { job } = await api.job(jobId);
        if (cancelled) return;
        setJobStatus(job.status);
        if (job.status === 'done') {
          await load();
          if (!cancelled) {
            setJobId(null);
            setJobStatus(null);
          }
          return;
        }
        if (job.status === 'failed') {
          setError(job.error || 'artifact generation failed');
          setJobId(null);
          setJobStatus(null);
          return;
        }
      } catch (e) {
        if (cancelled) return;
        // Transient fetch error — keep polling unless we've hit the timeout.
        if (Date.now() - pollStart.current > POLL_TIMEOUT_MS) {
          setError(e instanceof Error ? e.message : String(e));
          setJobId(null);
          setJobStatus(null);
          return;
        }
      }
      if (Date.now() - pollStart.current > POLL_TIMEOUT_MS) {
        setError('regenerate is taking longer than 10 minutes — check the Queue view');
        setJobId(null);
        setJobStatus(null);
        return;
      }
      if (!cancelled) window.setTimeout(tick, POLL_MS);
    };

    window.setTimeout(tick, POLL_MS);
    return () => { cancelled = true; };
  }, [jobId, load]);

  const onRegenerate = async () => {
    if (regenBusy || jobId !== null) return;
    setRegenBusy(true);
    setError(null);
    try {
      const resp = await api.regenerateArtifacts(article.id);
      const id = typeof resp.job_id === 'number' ? resp.job_id : Number(resp.job_id);
      if (Number.isFinite(id) && id > 0) {
        setJobId(id);
        setJobStatus('queued');
      } else {
        // Fallback: no job id came back — just reload once. Shouldn't happen
        // with the current backend, but don't freeze the UI if it does.
        await load();
      }
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

  const buttonLabel = regenBusy
    ? '…'
    : jobStatus === 'running'
      ? 'Running…'
      : jobStatus === 'queued'
        ? 'Queued…'
        : '＋ Regenerate';

  const busy = regenBusy || jobId !== null;

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
          disabled={busy}
          title={busy ? 'A regenerate job is in flight' : 'Regenerate artifacts'}
        >
          {buttonLabel}
        </button>
      </div>

      {artifacts === null && !error && (
        <div className="artifact-empty">Loading…</div>
      )}

      {error && (
        <div className="artifact-error">Couldn’t generate artifacts. {error}</div>
      )}

      {artifacts !== null && artifacts.length === 0 && !error && !busy && (
        <div className="artifact-empty">
          No artifacts yet. Click regenerate to queue some.
        </div>
      )}

      {artifacts !== null && artifacts.length === 0 && busy && !error && (
        <div className="artifact-empty">
          {jobStatus === 'running'
            ? 'Agent is drafting artifacts — this usually takes 1–3 minutes.'
            : 'Queued. The artifact agent will pick this up within 2 minutes.'}
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

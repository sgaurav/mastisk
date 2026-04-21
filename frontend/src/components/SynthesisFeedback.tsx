import { useEffect, useRef, useState } from 'react';
import type { SynthesisRun } from '../types';
import { api } from '../api';

interface Props {
  articleId: string;
}

type Phase = 'loading' | 'hidden' | 'pending' | 'reject-form' | 'submitting';

/**
 * Accept/discard strip for a Synthesizer-generated article.
 *
 * Mounts, fetches the most recent synthesis_run for this article, and renders
 * nothing unless the run exists and is still pending review. After a decision
 * lands we optimistically hide the card; on error we restore it with an inline
 * message so the user can retry.
 *
 * Safe against unmount-during-fetch: every async branch checks ``mounted.current``
 * before calling setState, so a late response on a stale article id becomes a
 * no-op rather than a warning.
 */
export function SynthesisFeedback({ articleId }: Props) {
  const [run, setRun] = useState<SynthesisRun | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    // Article changed — reset local state and refetch.
    setRun(null);
    setPhase('loading');
    setFeedback('');
    setError(null);

    let cancelled = false;
    (async () => {
      try {
        const r = await api.synthesisForArticle(articleId);
        if (cancelled || !mounted.current) return;
        if (!r.run || r.run.user_accepted !== null) {
          setPhase('hidden');
          setRun(null);
        } else {
          setRun(r.run);
          setPhase('pending');
        }
      } catch {
        if (cancelled || !mounted.current) return;
        // Silent: we don't want a flaky request to fill the article with noise.
        setPhase('hidden');
      }
    })();
    return () => { cancelled = true; };
  }, [articleId]);

  if (phase === 'loading' || phase === 'hidden' || !run) return null;

  const acceptedHide = () => {
    // Optimistic: drop to hidden before the POST resolves.
    setPhase('hidden');
  };

  const onKeep = async () => {
    if (!run) return;
    const snapshot = run;
    setError(null);
    acceptedHide();
    try {
      await api.acceptSynthesis(snapshot.id);
    } catch (e) {
      if (!mounted.current) return;
      setRun(snapshot);
      setPhase('pending');
      setError(e instanceof Error ? e.message : 'Could not save — try again.');
    }
  };

  const onSubmitReject = async () => {
    if (!run) return;
    const snapshot = run;
    const reason = feedback.trim();
    setError(null);
    setPhase('submitting');
    try {
      await api.rejectSynthesis(snapshot.id, reason || undefined);
      if (!mounted.current) return;
      setPhase('hidden');
    } catch (e) {
      if (!mounted.current) return;
      setRun(snapshot);
      setPhase('reject-form');
      setError(e instanceof Error ? e.message : 'Could not save — try again.');
    }
  };

  const createdLabel = formatDate(run.created_at);
  const scoreLabel = run.eval_score != null ? `critic graded ${formatScore(run.eval_score)}/5` : null;

  return (
    <div className="synth-feedback">
      <div className="synth-feedback-meta">
        <span className="synth-feedback-label">Synthesizer draft</span>
        <span className="sep">·</span>
        <span>drafted {createdLabel}</span>
        {scoreLabel && (
          <>
            <span className="sep">·</span>
            <span>{scoreLabel}</span>
          </>
        )}
      </div>

      <p className="synth-feedback-copy">
        This synthesis was drafted by the Synthesizer. Keep it in the wiki, or discard with a note
        so the next draft learns from the miss.
      </p>

      {phase === 'pending' && (
        <div className="synth-feedback-actions">
          <button
            className="synth-feedback-btn keep"
            onClick={onKeep}
            type="button"
          >
            Keep
          </button>
          <button
            className="synth-feedback-btn discard"
            onClick={() => { setError(null); setPhase('reject-form'); }}
            type="button"
          >
            Discard with reason
          </button>
          {error && <span className="synth-feedback-error">{error}</span>}
        </div>
      )}

      {(phase === 'reject-form' || phase === 'submitting') && (
        <div className="synth-feedback-form">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What went wrong? (optional — leave blank if you'd rather not say)"
            rows={3}
            disabled={phase === 'submitting'}
            autoFocus
          />
          <div className="synth-feedback-actions">
            <button
              className="synth-feedback-btn keep"
              onClick={onSubmitReject}
              type="button"
              disabled={phase === 'submitting'}
            >
              {phase === 'submitting' ? 'Saving…' : 'Submit'}
            </button>
            <button
              className="synth-feedback-btn discard"
              onClick={() => { setFeedback(''); setError(null); setPhase('pending'); }}
              type="button"
              disabled={phase === 'submitting'}
            >
              Cancel
            </button>
            {error && <span className="synth-feedback-error">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '';
  // SQLite's CURRENT_TIMESTAMP is ISO-ish but UTC without a 'Z'; normalize.
  const parsed = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatScore(s: number): string {
  // Critic returns 0..5 as a float; one-decimal read is plenty.
  return (Math.round(s * 10) / 10).toString();
}

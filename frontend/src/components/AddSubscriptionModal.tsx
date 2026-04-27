import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useModalA11y } from '../hooks/useModalA11y';
import type { SubscriptionKind, SubscriptionResolved } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: (url: string) => void;
}

type ProbeState =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'detected'; data: SubscriptionResolved }
  | { kind: 'error'; message: string };

const PROBE_DEBOUNCE_MS = 400;

export function AddSubscriptionModal({ open, onClose, onAdded }: Props) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [backfill, setBackfill] = useState(3);
  const [bypass, setBypass] = useState(true);
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { modalRef, ariaProps } = useModalA11y({
    open, onClose, initialFocusRef: inputRef,
  });

  // Reset state on open
  useEffect(() => {
    if (open) {
      setUrl('');
      setTitle('');
      setTitleEdited(false);
      setBackfill(3);
      setBypass(true);
      setProbe({ kind: 'idle' });
      setBusy(false);
      setSubmitError(null);
    }
  }, [open]);

  // Debounced probe as URL changes
  useEffect(() => {
    if (!open) return;
    const trimmed = url.trim();
    if (!trimmed) {
      setProbe({ kind: 'idle' });
      return;
    }
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setProbe({ kind: 'idle' });
      return;
    }
    setProbe({ kind: 'probing' });
    const handle = setTimeout(async () => {
      try {
        const data = await api.subscriptions.probe(trimmed);
        setProbe({ kind: 'detected', data });
        // Per-kind defaults: bypass interest filter for YouTube/podcast.
        setBypass(data.kind !== 'rss');
        if (!titleEdited) setTitle(data.title);
      } catch (e) {
        const msg = e instanceof ApiError ? e.detail : (e instanceof Error ? e.message : 'probe failed');
        setProbe({ kind: 'error', message: msg });
      }
    }, PROBE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [url, open, titleEdited]);

  const submit = async () => {
    if (probe.kind !== 'detected') return;
    setBusy(true);
    setSubmitError(null);
    try {
      const out = await api.subscriptions.create({
        url: url.trim(),
        title: title.trim() || undefined,
        backfill,
        bypass_interest_gate: bypass,
      });
      onAdded(out.subscription.url);
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail : (e instanceof Error ? e.message : 'create failed');
      setSubmitError(msg);
      setBusy(false);
    }
  };

  if (!open) return null;

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
        ref={modalRef}
        {...ariaProps}
        aria-labelledby="add-sub-title"
        tabIndex={-1}
        style={{
          background: 'var(--bg)', border: '1px solid var(--border, var(--line))',
          borderRadius: 8, padding: 18, width: 'min(480px, 92vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id="add-sub-title"
          style={{ fontSize: 12, color: 'var(--fg-faint)', marginBottom: 10, fontFamily: 'var(--mono)' }}
        >
          add a subscription
        </div>

        <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginBottom: 4, fontFamily: 'var(--mono)' }}>
          URL
        </div>
        <input
          ref={inputRef}
          value={url}
          onChange={(e) => { setUrl(e.target.value); setSubmitError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && probe.kind === 'detected' && !busy) void submit(); }}
          disabled={busy}
          placeholder="youtube.com/@channel · podcast feed · Apple Podcasts URL · RSS feed"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'transparent', color: 'var(--fg)',
            border: '1px solid var(--border, var(--line))', borderRadius: 4,
            padding: 8, fontFamily: 'var(--mono)', fontSize: 13,
          }}
        />

        <ProbePill state={probe} />

        {probe.kind === 'detected' && (
          <>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginBottom: 4, fontFamily: 'var(--mono)' }}>
                Title <span style={{ opacity: 0.6 }}>(blank uses default)</span>
              </div>
              <input
                value={title}
                onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }}
                disabled={busy}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'transparent', color: 'var(--fg)',
                  border: '1px solid var(--border, var(--line))', borderRadius: 4,
                  padding: 8, fontFamily: 'var(--mono)', fontSize: 13,
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 12, alignItems: 'flex-end' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginBottom: 4, fontFamily: 'var(--mono)' }}>
                  Backfill
                </div>
                <input
                  type="number" min={0} max={50}
                  value={backfill}
                  onChange={(e) => setBackfill(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
                  disabled={busy}
                  style={{
                    width: 80, background: 'transparent', color: 'var(--fg)',
                    border: '1px solid var(--border, var(--line))', borderRadius: 4,
                    padding: 8, fontFamily: 'var(--mono)', fontSize: 13,
                  }}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--fg-mute)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={bypass}
                  onChange={(e) => setBypass(e.target.checked)}
                  disabled={busy}
                />
                Bypass interest filter
              </label>
            </div>
          </>
        )}

        {submitError && (
          <div style={{ marginTop: 12, color: '#c53030', fontSize: 12, fontFamily: 'var(--mono)' }}>
            {submitError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy}>cancel</button>
          <button
            onClick={() => void submit()}
            disabled={busy || probe.kind !== 'detected'}
          >
            {busy ? 'subscribing…' : 'subscribe'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProbePill({ state }: { state: ProbeState }) {
  if (state.kind === 'idle') return <div style={{ height: 10 }} />;
  if (state.kind === 'probing') {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-faint)', fontFamily: 'var(--mono)' }}>
        probing…
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div style={{ marginTop: 8, fontSize: 12, color: '#c53030', fontFamily: 'var(--mono)' }}>
        ✗ {state.message}
      </div>
    );
  }
  const { data } = state;
  return (
    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent, var(--fg))', fontFamily: 'var(--mono)' }}>
      ✓ Detected: {kindLabel(data.kind)} · {data.title}
      {data.item_count != null && <span style={{ opacity: 0.7 }}> · {formatCount(data.item_count)} items</span>}
    </div>
  );
}

function kindLabel(k: SubscriptionKind): string {
  if (k === 'youtube') return 'YouTube';
  if (k === 'podcast') return 'Podcast';
  return 'RSS';
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

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

  useEffect(() => {
    if (!open) return;
    const trimmed = url.trim();
    if (!trimmed) { setProbe({ kind: 'idle' }); return; }
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      setProbe({ kind: 'idle' });
      return;
    }
    setProbe({ kind: 'probing' });
    const handle = setTimeout(async () => {
      try {
        const data = await api.subscriptions.probe(trimmed);
        setProbe({ kind: 'detected', data });
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
          background: 'var(--bg-elev)', border: '1px solid var(--line)',
          borderRadius: 8, padding: 20, width: 'min(480px, 92vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id="add-sub-title"
          style={{ fontSize: 12, color: 'var(--fg-faint)', marginBottom: 14, fontFamily: 'var(--mono)' }}
        >
          add a subscription
        </div>

        <Label>URL</Label>
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setSubmitError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && probe.kind === 'detected' && !busy) void submit(); }}
          disabled={busy}
          placeholder="youtube.com/@channel · podcast feed · Apple Podcasts URL · RSS"
          style={inputStyle()}
        />

        <ProbePill state={probe} />

        {probe.kind === 'detected' && (
          <>
            <div style={{ marginTop: 14 }}>
              <Label hint="blank uses the source's name">Title</Label>
              <input
                type="text"
                value={title}
                onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }}
                disabled={busy}
                style={inputStyle()}
              />
            </div>

            <div style={{ display: 'flex', gap: 18, marginTop: 14, alignItems: 'flex-end' }}>
              <div>
                <Label>Backfill</Label>
                <input
                  type="number" min={0} max={50}
                  value={backfill}
                  onChange={(e) => setBackfill(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
                  disabled={busy}
                  style={{ ...inputStyle(), width: 80 }}
                />
              </div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: 'var(--fg-mute)', cursor: 'pointer',
                paddingBottom: 8,
              }}>
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
          <div style={{
            marginTop: 14, padding: '8px 10px', borderRadius: 4,
            background: 'rgba(197,48,48,0.08)', border: '1px solid rgba(197,48,48,0.3)',
            color: '#c53030', fontFamily: 'var(--mono)', fontSize: 12,
          }}>
            {submitError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} disabled={busy} style={btnGhost()}>cancel</button>
          <button
            onClick={() => void submit()}
            disabled={busy || probe.kind !== 'detected'}
            style={btnPrimary(busy || probe.kind !== 'detected')}
          >
            {busy ? 'subscribing…' : 'subscribe'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{
      fontSize: 11, color: 'var(--fg-faint)', marginBottom: 4,
      fontFamily: 'var(--mono)',
    }}>
      {children}
      {hint && <span style={{ marginLeft: 6, opacity: 0.7 }}>({hint})</span>}
    </div>
  );
}

function ProbePill({ state }: { state: ProbeState }) {
  if (state.kind === 'idle') return <div style={{ height: 8 }} />;
  if (state.kind === 'probing') {
    return (
      <div style={{
        marginTop: 8, fontSize: 12, color: 'var(--fg-faint)',
        fontFamily: 'var(--mono)',
      }}>
        probing…
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div style={{
        marginTop: 8, padding: '6px 10px', borderRadius: 4,
        background: 'rgba(197,48,48,0.08)', border: '1px solid rgba(197,48,48,0.25)',
        color: '#c53030', fontFamily: 'var(--mono)', fontSize: 12,
      }}>
        {state.message}
      </div>
    );
  }
  const { data } = state;
  return (
    <div style={{
      marginTop: 8,
      fontSize: 12, color: 'var(--fg-mute)',
      fontFamily: 'var(--mono)',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{ color: 'var(--fg)', fontWeight: 600 }}>✓</span>
      <span>{kindLabel(data.kind)}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span style={{ color: 'var(--fg)' }}>{data.title}</span>
      {data.item_count != null && (
        <>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{formatCount(data.item_count)} items</span>
        </>
      )}
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

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 6,
    background: 'var(--bg-card)',
    color: 'var(--fg)',
    border: '1px solid var(--line)',
    fontSize: 13,
    fontFamily: 'var(--sans)',
  };
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 6,
    background: disabled ? 'var(--bg-sunk)' : 'var(--accent)',
    color: disabled ? 'var(--fg-faint)' : 'var(--fg-inv)',
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none',
  };
}

function btnGhost(): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 6,
    background: 'transparent',
    color: 'var(--fg-mute)',
    fontSize: 13,
    border: '1px solid var(--line)',
    cursor: 'pointer',
  };
}

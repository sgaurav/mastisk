import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { View } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: (slug: string) => void;
  onNavigate?: (view: View, id?: string) => void;
}

export function AddRepoModal({ open, onClose, onAdded, onNavigate }: Props) {
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSlug('');
      setError(null);
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

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
      onAdded(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
      setBusy(false);
    }
  };

  if (!open) return null;

  // Highlight PAT/private-repo hints so users know the fix path.
  const lower = (error ?? '').toLowerCase();
  const hintsPat = lower.includes('pat') || lower.includes('private');

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
          ref={inputRef}
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
        {error && (
          <div
            style={{
              color: 'var(--danger, crimson)',
              marginTop: 6,
              fontSize: 12,
              fontWeight: hintsPat ? 600 : 400,
            }}
          >
            {error}
            {hintsPat && onNavigate && (
              <>
                {' '}
                <a
                  href="#settings"
                  onClick={(e) => {
                    e.preventDefault();
                    onClose();
                    onNavigate('settings');
                  }}
                  style={{ color: 'var(--accent, #0a7)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  → open Settings
                </a>
              </>
            )}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          <button onClick={onClose} disabled={busy}>cancel</button>
          <button onClick={submit} disabled={busy || !slug.trim()}>{busy ? 'verifying…' : 'add'}</button>
        </div>
      </div>
    </div>
  );
}

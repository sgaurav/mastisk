import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { View } from '../types';

type Source = 'github' | 'local';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded: (slug: string) => void;
  onNavigate?: (view: View, id?: string) => void;
}

export function AddRepoModal({ open, onClose, onAdded, onNavigate }: Props) {
  const [source, setSource] = useState<Source>('github');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSource('github');
      setValue('');
      setError(null);
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Reset the input when switching tabs so placeholder cues match.
  useEffect(() => {
    if (!open) return;
    setValue('');
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [source, open]);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(source === 'github' ? 'expected owner/repo' : 'expected absolute path');
      return;
    }
    if (source === 'github' && !trimmed.includes('/')) {
      setError('expected owner/repo');
      return;
    }
    if (source === 'local' && !trimmed.startsWith('/') && !trimmed.startsWith('~')) {
      setError('expected absolute path (starts with / or ~)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (source === 'github') {
        await api.repos.add(trimmed);
        onAdded(trimmed);
      } else {
        const res = await api.repos.addLocal(trimmed);
        onAdded(res.slug);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
      setBusy(false);
    }
  };

  if (!open) return null;

  // Highlight PAT/private-repo hints so users know the fix path.
  const lower = (error ?? '').toLowerCase();
  const hintsPat = source === 'github' && (lower.includes('pat') || lower.includes('private'));

  const tabButtonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '6px 10px',
    border: 'none',
    background: active ? 'var(--fg)' : 'transparent',
    color: active ? 'var(--bg)' : 'var(--fg)',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'var(--mono)',
  });

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
          add a repo
        </div>
        <div
          style={{
            display: 'flex', gap: 0, marginBottom: 10,
            border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden',
          }}
        >
          <button onClick={() => setSource('github')} style={tabButtonStyle(source === 'github')}>
            GitHub
          </button>
          <button onClick={() => setSource('local')} style={tabButtonStyle(source === 'local')}>
            Local
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-faint)', marginBottom: 4, fontFamily: 'var(--mono)' }}>
          {source === 'github' ? 'GitHub slug' : 'Absolute path'}
        </div>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') onClose(); }}
          disabled={busy}
          placeholder={source === 'github' ? 'owner/repo' : '/Users/you/Code/someproj'}
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
          <button onClick={submit} disabled={busy || !value.trim()}>{busy ? 'verifying…' : 'add'}</button>
        </div>
      </div>
    </div>
  );
}

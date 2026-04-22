import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  open: boolean;
  onClose: () => void;
  onCaptured?: (noteId: number) => void;
}

export function NoteCaptureModal({ open, onClose, onCaptured }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
      setTimeout(() => ref.current?.focus(), 50);
    }
  }, [open]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) { setError('empty note'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api.notes.create(trimmed);
      onCaptured?.(res.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }, [text, onCaptured, onClose]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [submit, onClose]);

  if (!open) return null;

  return (
    <div
      className="note-capture-backdrop"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '10vh', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="note-capture-card"
        style={{
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 16, width: 'min(640px, 92vw)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 12, color: 'var(--fg-faint)', marginBottom: 8, fontFamily: 'var(--mono)' }}>
          capture note — ⌘↵ to save, esc to cancel
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          placeholder="what are you thinking?"
          rows={8}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'transparent', color: 'var(--fg)',
            border: '1px solid var(--border)', borderRadius: 4,
            padding: 10, fontFamily: 'var(--mono)', fontSize: 14,
            resize: 'vertical',
          }}
        />
        {error && <div style={{ color: 'var(--danger, crimson)', marginTop: 6, fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          <button onClick={onClose} disabled={busy}>cancel</button>
          <button onClick={submit} disabled={busy || !text.trim()}>
            {busy ? 'saving…' : 'save ⌘↵'}
          </button>
        </div>
      </div>
    </div>
  );
}

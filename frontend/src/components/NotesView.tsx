import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Note, View } from '../types';

interface Props {
  onNavigate: (view: View, id?: string) => void;
}

export function NotesView({ onNavigate }: Props) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.notes.list(100)
      .then(setNotes)
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, []);

  if (err) return <div className="view"><p style={{ color: 'var(--danger, crimson)' }}>{err}</p></div>;
  if (!notes) return <div className="view"><p style={{ color: 'var(--fg-faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>loading…</p></div>;

  if (notes.length === 0) {
    return (
      <div className="view">
        <div className="view-h">Notes</div>
        <h1 className="view-title">No notes yet</h1>
        <p className="view-sub">
          Hit the <kbd>+</kbd> in the titlebar, or run <code>mastisk note "your thought"</code>, or drop a
          markdown file into <code>vault/_notes/inbox/</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view-h">Notes</div>
      <h1 className="view-title">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {notes.map((n) => (
          <button
            key={n.id}
            onClick={() => onNavigate('note', String(n.id))}
            style={{
              textAlign: 'left', padding: 10,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg-soft, transparent)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-faint)' }}>
              {new Date(n.created_at).toLocaleString()} · {n.source}
              {n.classification && <> · <span>{n.classification}</span></>}
              {!n.classification && <> · <span style={{ opacity: 0.6 }}>unclassified</span></>}
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              {n.summary ?? n.slug}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

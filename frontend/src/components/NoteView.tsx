import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Note, View } from '../types';

interface Props {
  noteId: number;
  onNavigate: (view: View, id?: string) => void;
}

export function NoteView({ noteId, onNavigate }: Props) {
  const [note, setNote] = useState<Note | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setNote(null);
    setErr(null);
    api.notes.get(noteId)
      .then(setNote)
      .catch((e) => setErr(e instanceof Error ? e.message : 'failed'));
  }, [noteId]);

  const onDelete = useCallback(async () => {
    if (!note) return;
    if (!confirm(`Delete note?\n\n${note.summary ?? note.slug}`)) return;
    setDeleting(true);
    try {
      await api.notes.delete(note.id);
      onNavigate('notes');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
      setDeleting(false);
    }
  }, [note, onNavigate]);

  if (err) return <div className="view"><p style={{ color: 'var(--danger, crimson)' }}>{err}</p></div>;
  if (!note) return <div className="view"><p style={{ color: 'var(--fg-faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>loading…</p></div>;

  return (
    <div className="view">
      <div className="view-h">Note · {note.source}</div>
      <h1 className="view-title">{note.summary ?? note.slug}</h1>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-faint)', marginBottom: 12 }}>
        {new Date(note.created_at).toLocaleString()}
        {note.classification && <> · {note.classification}</>}
        {note.tags.length > 0 && <> · {note.tags.map(t => `#${t}`).join(' ')}</>}
      </div>
      <pre
        style={{
          whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 14,
          background: 'var(--bg-soft, transparent)',
          border: '1px solid var(--border)', borderRadius: 6, padding: 12,
        }}
      >{note.body}</pre>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button onClick={() => onNavigate('notes')}>← all notes</button>
        <button onClick={onDelete} disabled={deleting} style={{ marginLeft: 'auto' }}>
          {deleting ? 'deleting…' : 'delete'}
        </button>
      </div>
    </div>
  );
}

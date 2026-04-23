import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useModalA11y } from '../hooks/useModalA11y';
import type { BrowseEntry, View } from '../types';

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

  // Folder-picker state (only used when source === 'local')
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseState, setBrowseState] = useState<{
    path: string; parent: string | null; entries: BrowseEntry[];
  } | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);

  const { modalRef, ariaProps } = useModalA11y({
    open,
    onClose,
    initialFocusRef: inputRef,
  });

  useEffect(() => {
    if (open) {
      setSource('github');
      setValue('');
      setError(null);
      setBusy(false);
      setBrowseOpen(false);
      setBrowseState(null);
    }
  }, [open]);

  // Reset the input when switching tabs so placeholder cues match.
  useEffect(() => {
    if (!open) return;
    setValue('');
    setError(null);
    setBrowseOpen(false);
    setBrowseState(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [source, open]);

  const loadBrowse = useCallback(async (path?: string) => {
    setBrowseBusy(true);
    try {
      const data = await api.repos.browse(path);
      setBrowseState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'browse failed');
    } finally {
      setBrowseBusy(false);
    }
  }, []);

  const openBrowser = () => {
    setBrowseOpen(true);
    void loadBrowse();  // start at ~
  };

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
        ref={modalRef}
        {...ariaProps}
        aria-labelledby="add-repo-title"
        tabIndex={-1}
        style={{
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 16, width: 'min(440px, 92vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id="add-repo-title"
          style={{ fontSize: 12, color: 'var(--fg-faint)', marginBottom: 8, fontFamily: 'var(--mono)' }}
        >
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
        {source === 'local' ? (
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              disabled={busy}
              placeholder="/Users/you/Code/someproj"
              style={{
                flex: 1, boxSizing: 'border-box',
                background: 'transparent', color: 'var(--fg)',
                border: '1px solid var(--border)', borderRadius: 4,
                padding: 8, fontFamily: 'var(--mono)', fontSize: 14,
              }}
            />
            <button type="button" onClick={openBrowser} disabled={busy} title="Browse folders">
              Browse
            </button>
          </div>
        ) : (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            disabled={busy}
            placeholder="owner/repo"
            style={{
              width: '100%', boxSizing: 'border-box',
              background: 'transparent', color: 'var(--fg)',
              border: '1px solid var(--border)', borderRadius: 4,
              padding: 8, fontFamily: 'var(--mono)', fontSize: 14,
            }}
          />
        )}
        {source === 'local' && browseOpen && (
          <div
            style={{
              border: '1px solid var(--border)', borderRadius: 4,
              marginBottom: 8, maxHeight: 320, display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Breadcrumb / up / "select this folder" */}
            <div
              style={{
                padding: '6px 8px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontFamily: 'var(--mono)',
              }}
            >
              <button
                type="button"
                disabled={!browseState?.parent || browseBusy}
                onClick={() => browseState?.parent && void loadBrowse(browseState.parent)}
                style={{ padding: '1px 6px' }}
                title="Up one level"
              >
                ↑
              </button>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {browseState?.path ?? '…'}
              </span>
              <button
                type="button"
                disabled={!browseState || browseBusy}
                onClick={() => {
                  if (browseState) { setValue(browseState.path); setBrowseOpen(false); }
                }}
                title="Use this folder"
              >
                select
              </button>
              <button type="button" onClick={() => setBrowseOpen(false)} title="Close">
                ✕
              </button>
            </div>
            {/* Entry list */}
            <div style={{ overflow: 'auto', padding: 4 }}>
              {browseBusy ? (
                <div style={{ padding: 8, fontSize: 12, color: 'var(--fg-faint)' }}>loading…</div>
              ) : !browseState || browseState.entries.filter(e => e.is_dir).length === 0 ? (
                <div style={{ padding: 8, fontSize: 12, color: 'var(--fg-faint)' }}>(no subdirectories)</div>
              ) : (
                browseState.entries
                  .filter(e => e.is_dir)
                  .map(e => (
                    <button
                      key={e.path}
                      type="button"
                      onClick={() => {
                        if (e.is_git_repo) { setValue(e.path); setBrowseOpen(false); }
                        else { void loadBrowse(e.path); }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        width: '100%', textAlign: 'left', padding: '4px 8px',
                        background: 'transparent', border: 'none',
                        fontSize: 13, cursor: 'pointer',
                        fontFamily: 'var(--mono)', color: 'var(--fg)',
                      }}
                      title={e.is_git_repo ? 'git repo — click to select' : 'folder — click to open'}
                    >
                      <span>{e.is_git_repo ? '*' : ''}</span>
                      <span style={{ flex: 1 }}>
                        {e.name}
                        {e.is_git_repo && (
                          <span style={{ color: 'var(--accent, #cc4444)', marginLeft: 6, fontSize: 10 }}>
                            [repo]
                          </span>
                        )}
                      </span>
                    </button>
                  ))
              )}
            </div>
          </div>
        )}
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

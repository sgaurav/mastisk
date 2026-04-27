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

  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseState, setBrowseState] = useState<{
    path: string; parent: string | null; entries: BrowseEntry[];
  } | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);

  const { modalRef, ariaProps } = useModalA11y({
    open, onClose, initialFocusRef: inputRef,
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
    void loadBrowse();
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

  const lower = (error ?? '').toLowerCase();
  const hintsPat = source === 'github' && (lower.includes('pat') || lower.includes('private'));

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
          background: 'var(--bg-elev)', border: '1px solid var(--line)',
          borderRadius: 8, padding: 20, width: 'min(440px, 92vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id="add-repo-title"
          style={{ fontSize: 12, color: 'var(--fg-faint)', marginBottom: 14, fontFamily: 'var(--mono)' }}
        >
          add a repo
        </div>

        <div
          style={{
            display: 'flex', gap: 0, marginBottom: 14,
            border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden',
          }}
        >
          <TabButton active={source === 'github'} onClick={() => setSource('github')}>GitHub</TabButton>
          <TabButton active={source === 'local'} onClick={() => setSource('local')}>Local</TabButton>
        </div>

        <Label>{source === 'github' ? 'GitHub slug' : 'Absolute path'}</Label>
        {source === 'local' ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              disabled={busy}
              placeholder="/Users/you/Code/someproj"
              style={inputStyle()}
            />
            <button type="button" onClick={openBrowser} disabled={busy} style={btnGhost()}>
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
            style={inputStyle()}
          />
        )}

        {source === 'local' && browseOpen && (
          <div
            style={{
              border: '1px solid var(--line)', borderRadius: 6,
              marginTop: 10, maxHeight: 320, display: 'flex', flexDirection: 'column',
              background: 'var(--bg-card)',
            }}
          >
            <div
              style={{
                padding: '8px 10px', borderBottom: '1px solid var(--line-soft)',
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--fg-mute)',
              }}
            >
              <button
                type="button"
                disabled={!browseState?.parent || browseBusy}
                onClick={() => browseState?.parent && void loadBrowse(browseState.parent)}
                style={browseBtnStyle()}
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
                style={browseBtnStyle()}
                title="Use this folder"
              >
                select
              </button>
              <button
                type="button"
                onClick={() => setBrowseOpen(false)}
                style={browseBtnStyle()}
                title="Close"
              >
                ✕
              </button>
            </div>
            <div style={{ overflow: 'auto', padding: 4 }}>
              {browseBusy ? (
                <div style={{ padding: 8, fontSize: 12, color: 'var(--fg-faint)', fontFamily: 'var(--mono)' }}>loading…</div>
              ) : !browseState || browseState.entries.filter(e => e.is_dir).length === 0 ? (
                <div style={{ padding: 8, fontSize: 12, color: 'var(--fg-faint)', fontFamily: 'var(--mono)' }}>(no subdirectories)</div>
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
                        width: '100%', textAlign: 'left', padding: '5px 8px',
                        background: 'transparent', border: 'none',
                        fontSize: 13, cursor: 'pointer',
                        fontFamily: 'var(--mono)', color: 'var(--fg)',
                        borderRadius: 4,
                      }}
                      title={e.is_git_repo ? 'git repo — click to select' : 'folder — click to open'}
                    >
                      <span style={{ width: 12, color: 'var(--fg-faint)' }}>{e.is_git_repo ? '·' : ''}</span>
                      <span style={{ flex: 1 }}>
                        {e.name}
                        {e.is_git_repo && (
                          <span style={{
                            color: 'var(--fg-mute)', marginLeft: 6, fontSize: 10,
                            border: '1px solid var(--line-soft)', borderRadius: 4, padding: '1px 5px',
                          }}>
                            repo
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
              marginTop: 12, padding: '8px 10px', borderRadius: 4,
              background: 'rgba(197,48,48,0.08)', border: '1px solid rgba(197,48,48,0.3)',
              color: '#c53030', fontFamily: 'var(--mono)', fontSize: 12,
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
                  style={{ color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  → open Settings
                </a>
              </>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} disabled={busy} style={btnGhost()}>cancel</button>
          <button
            onClick={submit}
            disabled={busy || !value.trim()}
            style={btnPrimary(busy || !value.trim())}
          >
            {busy ? 'verifying…' : 'add'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, color: 'var(--fg-faint)', marginBottom: 4,
      fontFamily: 'var(--mono)',
    }}>
      {children}
    </div>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 12px',
        border: 'none',
        background: active ? 'var(--bg-sunk)' : 'transparent',
        color: active ? 'var(--fg)' : 'var(--fg-mute)',
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'var(--mono)',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    flex: 1,
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

function browseBtnStyle(): React.CSSProperties {
  return {
    padding: '3px 8px',
    borderRadius: 4,
    background: 'transparent',
    color: 'var(--fg-mute)',
    fontSize: 11,
    border: '1px solid var(--line)',
    cursor: 'pointer',
    fontFamily: 'var(--mono)',
  };
}

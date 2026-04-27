import { useEffect, useState } from 'react';
import { api } from '../api';
import type { VaultSelfFile } from '../types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function VaultFilesSection() {
  const [files, setFiles] = useState<VaultSelfFile[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [contentLoading, setContentLoading] = useState(false);
  const [save, setSave] = useState<SaveState>('idle');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api.vault.listSelf()
      .then((r) => setFiles(r.files))
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!active) return;
    setContentLoading(true);
    setSave('idle');
    setErr(null);
    void api.vault.readSelf(active)
      .then((r) => { setLoaded(r.content); setContent(r.content); })
      .catch((e) => setErr(String(e)))
      .finally(() => setContentLoading(false));
  }, [active]);

  const dirty = content !== loaded;

  const submit = async () => {
    if (!active) return;
    setSave('saving');
    try {
      await api.vault.writeSelf(active, content);
      setLoaded(content);
      setSave('saved');
      // Refresh the file metadata (size/mtime) so the picker reflects the new size.
      const r = await api.vault.listSelf();
      setFiles(r.files);
    } catch (e) {
      setErr(String(e));
      setSave('error');
    }
  };

  const revert = () => {
    setContent(loaded);
    setSave('idle');
    setErr(null);
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Vault files</h2>
      <p className="settings-section-hint">
        These markdown files steer agent prompts. Edits take effect on the next agent tick — no restart needed.
      </p>

      <div className="vault-files-pills">
        {(files ?? []).map((f) => (
          <button
            key={f.name}
            className={`vault-files-pill ${active === f.name ? 'active' : ''}`}
            onClick={() => setActive(f.name)}
            type="button"
            disabled={contentLoading && active !== f.name}
          >
            <div className="vault-files-pill-name">{f.name}.md</div>
            <div className="vault-files-pill-meta">
              {f.exists ? `${formatSize(f.size)}` : 'missing'}
            </div>
          </button>
        ))}
        {!files && <span style={{ color: 'var(--fg-faint)' }}>loading…</span>}
      </div>

      {active && (
        <div className="settings-row" style={{ alignItems: 'stretch' }}>
          <label className="settings-label">
            <div className="k">{active}.md</div>
            <div className="h">{describe(active)}</div>
          </label>
          <div className="settings-ctl" style={{ alignItems: 'stretch' }}>
            <textarea
              className="vault-files-textarea"
              value={content}
              onChange={(e) => { setContent(e.target.value); setSave('idle'); setErr(null); }}
              rows={24}
              spellCheck={false}
              disabled={contentLoading}
              placeholder={contentLoading ? 'loading…' : ''}
            />
            <div className="vault-files-footer">
              <button
                className="settings-save"
                onClick={() => void submit()}
                disabled={!dirty || save === 'saving' || contentLoading}
              >
                {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : 'Save'}
              </button>
              {dirty && (
                <button className="settings-cancel" onClick={revert} disabled={save === 'saving'}>
                  Revert
                </button>
              )}
              {err && <span className="settings-error">{err}</span>}
              {!err && !dirty && save === 'idle' && (
                <span style={{ color: 'var(--fg-faint)', fontSize: 12 }}>up to date</span>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function describe(name: string): string {
  switch (name) {
    case 'identity': return 'who you are — role, expertise, perspective';
    case 'interests': return 'topics Scout should track (embedding similarity gate)';
    case 'dislikes': return 'topics to filter out (substring match on title + summary)';
    case 'style': return 'how you want articles written';
    case 'learnings': return 'auto-appended by the Reflection agent';
    default: return '';
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

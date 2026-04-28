import { useEffect, useState } from 'react';
import { api } from '../api';
import type { DiscoverValues, DiscoveryBlocklistItem, SettingsBundle, SettingsPatch } from '../types';
import { VaultFilesSection } from './VaultFilesSection';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type GithubState = { pat_set: boolean; pat_last4: string | null } | null;
type GhMsg = { kind: 'ok' | 'err'; text: string } | null;

export function SettingsView() {
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [draft, setDraft] = useState<SettingsPatch>({});
  const [keyInput, setKeyInput] = useState('');
  const [save, setSave] = useState<SaveState>('idle');
  const [err, setErr] = useState<string | null>(null);

  const [githubState, setGithubState] = useState<GithubState>(null);
  const [newPat, setNewPat] = useState('');
  const [ghSaveBusy, setGhSaveBusy] = useState(false);
  const [ghTestBusy, setGhTestBusy] = useState(false);
  const [ghMsg, setGhMsg] = useState<GhMsg>(null);

  useEffect(() => {
    void api.settings().then((b) => { setBundle(b); setDraft({}); setKeyInput(''); }).catch((e) => setErr(String(e)));
    void api.github.get()
      .then((g) => setGithubState({ pat_set: g.pat_set, pat_last4: g.pat_last4 }))
      .catch(() => setGithubState({ pat_set: false, pat_last4: null }));
  }, []);

  if (!bundle) {
    return (
      <div className="view">
        {err ? <p style={{color:'#c53030'}}>{err}</p> : <p style={{color:'var(--fg-faint)'}}>loading…</p>}
      </div>
    );
  }

  const v = bundle.values;
  const cur = <K extends keyof typeof v>(k: K) => (draft as Record<string, unknown>)[k as string] ?? v[k];
  const set = (patch: SettingsPatch) => { setDraft((d) => ({ ...d, ...patch })); setSave('idle'); setErr(null); };
  const setBudget = (k: keyof typeof v.budget, n: number) => {
    const base = draft.budget ?? { ...v.budget };
    set({ budget: { ...base, [k]: n } });
  };

  const submit = async () => {
    setSave('saving');
    try {
      const patch: SettingsPatch = { ...draft };
      // Only send the cloud key if the user actually typed one (including "" to clear).
      if (keyInput !== '') patch.ollama_cloud_key = keyInput;
      await api.saveSettings(patch);
      const fresh = await api.settings();
      setBundle(fresh);
      setDraft({});
      setKeyInput('');
      setSave('saved');
    } catch (e) {
      setErr(String(e));
      setSave('error');
    }
  };

  const clearKey = async () => {
    setSave('saving');
    try {
      await api.saveSettings({ ollama_cloud_key: '' });
      const fresh = await api.settings();
      setBundle(fresh);
      setKeyInput('');
      setSave('saved');
    } catch (e) {
      setErr(String(e));
      setSave('error');
    }
  };

  const cloudActive = bundle.cloud_active;
  const hasDraft = Object.keys(draft).length > 0 || keyInput !== '';

  return (
    <div className="view settings-view">
      <div className="view-h">System · Settings</div>
      <h1 className="view-title">Settings.</h1>
      <p className="view-sub">
        Write straight into <code style={{fontFamily:'var(--mono)',fontSize:12,background:'var(--bg-sunk)',padding:'1px 6px',borderRadius:4}}>{bundle.config_path}</code>.
        Model, URL, and budget changes apply immediately; the Claude CLI path is picked up on the next subprocess call.
      </p>

      <Section title="Claude (full-article compiler)">
        <Field
          label="claude_cmd"
          hint={bundle.model_roles.claude_cmd}
          value={String(cur('claude_cmd'))}
          onChange={(val) => set({ claude_cmd: val })}
          placeholder="claude"
        />
      </Section>

      <Section title="Ollama connection">
        <Field
          label="ollama_local_url"
          hint="Where your local Ollama daemon is listening. The default port is 11434."
          value={String(cur('ollama_local_url'))}
          onChange={(val) => set({ ollama_local_url: val })}
          placeholder="http://localhost:11434"
        />
        <Toggle
          label="ollama_local_only"
          hint="When on, cloud-proxied models are never called even if a key is configured. Turn off to use Ollama Cloud."
          value={Boolean(cur('ollama_local_only'))}
          onChange={(val) => set({ ollama_local_only: val })}
        />
        <div className="settings-row">
          <label className="settings-label">
            <div className="k">ollama_cloud_key</div>
            <div className="h">
              Sign in to <a href="https://ollama.com" target="_blank" rel="noreferrer">ollama.com</a> and paste the API key here.
              Stored only in your local config.toml.
            </div>
          </label>
          <div className="settings-ctl">
            <input
              type="password"
              autoComplete="off"
              value={keyInput}
              placeholder={v.ollama_cloud_key_set ? '•••••••• (set — leave blank to keep)' : 'paste a key to enable cloud'}
              onChange={(e) => { setKeyInput(e.target.value); setSave('idle'); }}
            />
            <div className="settings-inline-note">
              {v.ollama_cloud_key_set ? (
                <>
                  <span>Key is set.</span>
                  <button className="chip" onClick={() => void clearKey()} disabled={save==='saving'}>Clear key</button>
                </>
              ) : (
                <span>No cloud key on file.</span>
              )}
              <span className={`pill ${cloudActive ? 'on' : 'off'}`}>
                cloud {cloudActive ? 'active' : 'inactive'}
              </span>
            </div>
            {!cloudActive && v.ollama_cloud_key_set && v.ollama_local_only && (
              <div className="settings-inline-note warn">
                A key is configured but ollama_local_only is on — toggle it off to actually use the cloud.
              </div>
            )}
          </div>
        </div>
        <Field
          label="ollama_cloud_url"
          hint="Only edit this if you're proxying Ollama Cloud through your own host."
          value={String(cur('ollama_cloud_url'))}
          onChange={(val) => set({ ollama_cloud_url: val })}
          placeholder="https://ollama.com"
        />
      </Section>

      <Section title="Models">
        <Field
          label="embed_model"
          hint={bundle.model_roles.embed_model}
          value={String(cur('embed_model'))}
          onChange={(val) => set({ embed_model: val })}
          placeholder="nomic-embed-text"
        />
        <Field
          label="summarize_model_cheap"
          hint={bundle.model_roles.summarize_model_cheap}
          value={String(cur('summarize_model_cheap'))}
          onChange={(val) => set({ summarize_model_cheap: val })}
          placeholder="qwen3.5:4b"
        />
        <Field
          label="summarize_model_heavy"
          hint={bundle.model_roles.summarize_model_heavy}
          value={String(cur('summarize_model_heavy'))}
          onChange={(val) => set({ summarize_model_heavy: val })}
          placeholder="kimi-k2.5:cloud"
        />
      </Section>

      <Section title="GitHub">
        {githubState === null ? (
          <p className="settings-section-hint">loading…</p>
        ) : (
          <>
            <div className="settings-row">
              <label className="settings-label">
                <div className="k">Current PAT</div>
                <div className="h">
                  Without a PAT, mastisk polls public repos at 60 req/hour.
                  With a <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">classic PAT</a>
                  {' '}(scope: <code>public_repo</code> for public only, <code>repo</code> for private)
                  you get 5000/hour and access to private repos.
                </div>
              </label>
              <div className="settings-ctl">
                {githubState.pat_set ? (
                  <code style={{ fontFamily: 'var(--mono)' }}>{githubState.pat_last4}</code>
                ) : (
                  <em style={{ color: 'var(--fg-faint)' }}>not set (unauthenticated polling, 60 req/hr)</em>
                )}
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-label">
                <div className="k">github.pat</div>
                <div className="h">Paste a new token here and hit save. Empty string clears.</div>
              </label>
              <div className="settings-ctl">
                <input
                  type="password"
                  autoComplete="off"
                  value={newPat}
                  placeholder="ghp_... (classic) or github_pat_... (fine-grained)"
                  onChange={(e) => { setNewPat(e.target.value); setGhMsg(null); }}
                />
                <div className="settings-inline-note">
                  <button
                    className="chip"
                    disabled={ghSaveBusy}
                    onClick={async () => {
                      setGhSaveBusy(true);
                      setGhMsg(null);
                      try {
                        const res = await api.github.setPat(newPat);
                        setGithubState({ pat_set: res.pat_set, pat_last4: res.pat_last4 });
                        setNewPat('');
                        setGhMsg({ kind: 'ok', text: res.pat_set ? 'PAT saved' : 'PAT cleared' });
                      } catch (e) {
                        setGhMsg({ kind: 'err', text: e instanceof Error ? e.message : 'save failed' });
                      } finally {
                        setGhSaveBusy(false);
                      }
                    }}
                  >
                    {ghSaveBusy ? 'saving…' : 'Save'}
                  </button>
                  {githubState.pat_set && (
                    <button
                      className="chip"
                      disabled={ghTestBusy}
                      onClick={async () => {
                        setGhTestBusy(true);
                        setGhMsg(null);
                        try {
                          const r = await api.github.testPat();
                          setGhMsg({
                            kind: 'ok',
                            text: `authenticated as @${r.username} (${r.public_repos} public repos)`,
                          });
                        } catch (e) {
                          setGhMsg({ kind: 'err', text: e instanceof Error ? e.message : 'test failed' });
                        } finally {
                          setGhTestBusy(false);
                        }
                      }}
                    >
                      {ghTestBusy ? 'testing…' : 'Test'}
                    </button>
                  )}
                </div>
                {ghMsg && (
                  <div className={`settings-inline-note ${ghMsg.kind === 'err' ? 'warn' : ''}`}>
                    {ghMsg.text}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Section>

      <VaultFilesSection />

      <DiscoverySection
        values={v.discover}
        draft={draft.discover}
        setDraft={(patch) => set({ discover: { ...(draft.discover ?? {}), ...patch } })}
      />

      <Section title="Daily agent budgets">
        <p className="settings-section-hint">
          Caps on how many items each agent will act on per day. Stops a chatty feed from burning through cloud calls.
        </p>
        {(Object.keys(v.budget) as (keyof typeof v.budget)[]).map((k) => (
          <NumberField
            key={k}
            label={k}
            value={Number((draft.budget ?? v.budget)[k])}
            onChange={(n) => setBudget(k, n)}
          />
        ))}
      </Section>

      <div className="settings-footer">
        <button
          className="settings-save"
          onClick={() => void submit()}
          disabled={!hasDraft || save === 'saving'}
        >
          {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : 'Save changes'}
        </button>
        {hasDraft && (
          <button className="settings-cancel" onClick={() => { setDraft({}); setKeyInput(''); setSave('idle'); }}>
            Discard
          </button>
        )}
        {err && <span className="settings-error">{err}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label, hint, value, onChange, placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="settings-row">
      <label className="settings-label">
        <div className="k">{label}</div>
        <div className="h">{hint}</div>
      </label>
      <div className="settings-ctl">
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function NumberField({
  label, value, onChange,
}: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="settings-row">
      <label className="settings-label">
        <div className="k">{label}</div>
      </label>
      <div className="settings-ctl settings-ctl-number">
        <input
          type="number" min={0} max={100000} value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Math.max(0, Math.min(100000, Number(e.target.value) || 0)))}
        />
      </div>
    </div>
  );
}

function Select<T extends string | number>({
  label, hint, value, options, onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="settings-row">
      <label className="settings-label">
        <div className="k">{label}</div>
        {hint && <div className="h">{hint}</div>}
      </label>
      <div className="settings-ctl">
        <select
          value={String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            const match = options.find((o) => String(o.value) === raw);
            if (match) onChange(match.value);
          }}
          style={{
            padding: '6px 10px', borderRadius: 4,
            background: 'var(--bg-card)', color: 'var(--fg)',
            border: '1px solid var(--line)', fontSize: 13,
            fontFamily: 'var(--mono)',
          }}
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}


function DiscoverySection({
  values, draft, setDraft,
}: {
  values: DiscoverValues;
  draft: Partial<DiscoverValues> | undefined;
  setDraft: (patch: Partial<DiscoverValues>) => void;
}) {
  const cur = <K extends keyof DiscoverValues>(k: K) =>
    (draft?.[k] ?? values[k]) as DiscoverValues[K];

  const [blocklist, setBlocklist] = useState<DiscoveryBlocklistItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.discover.blocklist().then((d) => setBlocklist(d.blocklist)).catch(() => setBlocklist([]));
  }, []);

  const onUnblock = async (domain: string) => {
    setBusy(domain);
    try {
      await api.discover.unblock(domain);
      const d = await api.discover.blocklist();
      setBlocklist(d.blocklist);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Discovery">
      <p className="settings-section-hint">
        Curator surfaces sources outside your subscriptions that your trusted writers keep pointing at.
        Pure mechanical signal aggregation; LLM only as a final tie-breaker. Force a cycle now via{' '}
        <code style={{fontFamily:'var(--mono)',fontSize:12,background:'var(--bg-sunk)',padding:'1px 6px',borderRadius:4}}>mastisk discover-now</code>.
      </p>

      <Select
        label="Cadence"
        hint="how often the Curator runs"
        value={cur('cadence_hours')}
        options={[
          { value: 24, label: 'Daily' },
          { value: 168, label: 'Weekly' },
        ]}
        onChange={(v) => setDraft({ cadence_hours: v })}
      />

      <Select
        label="Confluence threshold"
        hint="min distinct trusted-source endorsements before surfacing"
        value={cur('min_confluence')}
        options={[
          { value: 1, label: 'Off (≥1)' },
          { value: 2, label: '2' },
          { value: 3, label: '3' },
        ]}
        onChange={(v) => setDraft({ min_confluence: v })}
      />

      <Toggle
        label="LLM judge"
        hint="run a Claude relevance pass over the survivor set each cycle (1 call per cycle)"
        value={cur('llm_judge_enabled')}
        onChange={(v) => setDraft({ llm_judge_enabled: v })}
      />

      <div className="settings-row" style={{alignItems:'flex-start'}}>
        <label className="settings-label">
          <div className="k">Blocked domains</div>
          <div className="h">domains the Curator will never re-surface</div>
        </label>
        <div className="settings-ctl" style={{display:'flex',flexDirection:'column',gap:6,alignItems:'stretch'}}>
          {blocklist === null && <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--fg-faint)'}}>loading…</span>}
          {blocklist !== null && blocklist.length === 0 && (
            <span style={{fontFamily:'var(--serif)',fontSize:13,color:'var(--fg-mute)'}}>(none)</span>
          )}
          {blocklist?.map((b) => (
            <div key={b.domain} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',borderBottom:'1px solid var(--line-soft)'}}>
              <span style={{flex:1,fontFamily:'var(--mono)',fontSize:12}}>{b.domain}</span>
              {b.reason && <span style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--fg-faint)'}}>{b.reason}</span>}
              <button
                onClick={() => void onUnblock(b.domain)}
                disabled={busy === b.domain}
                style={{
                  padding:'4px 10px',borderRadius:4,background:'transparent',
                  color:'var(--fg-mute)',border:'1px solid var(--line)',
                  fontSize:11,fontFamily:'var(--mono)',cursor:'pointer',
                }}
              >
                {busy === b.domain ? '…' : 'unblock'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}


function Toggle({
  label, hint, value, onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="settings-row">
      <label className="settings-label">
        <div className="k">{label}</div>
        <div className="h">{hint}</div>
      </label>
      <div className="settings-ctl">
        <button
          className={`settings-toggle ${value ? 'on' : 'off'}`}
          onClick={() => onChange(!value)}
          type="button"
          aria-pressed={value}
        >
          <span className="dot"/>
          <span className="lbl">{value ? 'on' : 'off'}</span>
        </button>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Discovery, DiscoveryKind, View } from '../types';

interface Props {
  onNavigate: (view: View, id?: string) => void;
  reloadKey?: number;
}

interface Toast {
  text: string;
  tone: 'ok' | 'err' | 'info';
  // Optional undo callback fires within ~5s if user clicks "Undo".
  onUndo?: () => Promise<void> | void;
}
type Filter = 'all' | DiscoveryKind;

export function DiscoverView({ onNavigate, reloadKey }: Props) {
  const [rows, setRows] = useState<Discovery[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  const reload = async () => {
    try {
      const d = await api.discover.list('open');
      setRows(d.discoveries);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed');
    }
  };

  useEffect(() => { void reload(); }, [reloadKey]);

  const flash = (t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 5000);
  };

  const onAccept = async (d: Discovery) => {
    setBusyId(d.id);
    try {
      const out = await api.discover.accept(d.id);
      flash({ text: `Subscribed to ${d.title || d.domain}`, tone: 'ok' });
      // Optionally jump to the new subscription detail page
      onNavigate('subscription', out.subscribed_url);
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    } finally {
      setBusyId(null);
      void reload();
    }
  };

  const onSave = async (d: Discovery) => {
    setBusyId(d.id);
    try {
      await api.discover.save(d.id);
      flash({ text: `Saved · ${d.title || d.domain}`, tone: 'ok' });
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    } finally {
      setBusyId(null);
      void reload();
    }
  };

  const onDismiss = async (d: Discovery) => {
    setBusyId(d.id);
    try {
      await api.discover.dismiss(d.id);
      flash({ text: 'Dismissed', tone: 'info' });
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    } finally {
      setBusyId(null);
      void reload();
    }
  };

  const onBlockDomain = async (d: Discovery) => {
    setBusyId(d.id);
    try {
      await api.discover.blockDomain(d.id);
      flash({
        text: `Blocked ${d.domain}`,
        tone: 'info',
        onUndo: async () => {
          try {
            await api.discover.unblock(d.domain);
            flash({ text: `Unblocked ${d.domain}`, tone: 'info' });
            void reload();
          } catch (e) {
            flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
          }
        },
      });
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    } finally {
      setBusyId(null);
      void reload();
    }
  };

  const onRunNow = async () => {
    setRunning(true);
    try {
      const r = await api.discover.runNow();
      flash({ text: r.message, tone: 'ok' });
      // Curator runs in background; reload after 30s to give it time.
      setTimeout(() => { void reload(); }, 30000);
    } catch (e) {
      flash({ text: e instanceof Error ? e.message : 'failed', tone: 'err' });
    } finally {
      setRunning(false);
    }
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (filter === 'all') return rows;
    return rows.filter((r) => r.kind === filter);
  }, [rows, filter]);

  if (err) return <div className="view"><p style={{ color: '#c53030' }}>{err}</p></div>;

  return (
    <div className="view">
      <div className="view-h">System · Discover</div>
      <h1 className="view-title">Sources your network keeps pointing at.</h1>
      <p className="view-sub">
        Surfaced from co-citation across your wiki, Substack recommendations from your subscriptions,
        repeated HN front-page domains, and arXiv references your papers cite. Curator runs weekly;
        force a cycle now via{' '}
        <code style={{fontFamily:'var(--mono)',fontSize:12,background:'var(--bg-sunk)',padding:'1px 6px',borderRadius:4}}>mastisk discover-now</code>{' '}
        or the button on the right.
      </p>

      <div style={{display:'flex',gap:10,alignItems:'center',margin:'24px 0 24px',flexWrap:'wrap'}}>
        {rows && rows.length > 0 && <FilterPills filter={filter} setFilter={setFilter} rows={rows}/>}
        <div style={{flex:1}}/>
        <button onClick={() => void onRunNow()} disabled={running} style={btnPrimary(running)}>
          {running ? 'running…' : 'Run now'}
        </button>
      </div>

      <div className="view-h">Pending discoveries {rows && `· ${rows.length}`}</div>

      {!rows && <p style={{color:'var(--fg-faint)',fontFamily:'var(--mono)',fontSize:12}}>loading…</p>}

      {rows && rows.length === 0 && (
        <div style={{padding:'24px',border:'1px dashed var(--line)',borderRadius:8,fontFamily:'var(--serif)',color:'var(--fg-mute)'}}>
          No discoveries yet. The Curator runs weekly and surfaces sources your trusted writers keep
          pointing at — co-citations across your wiki, Substack recommendations from your subscriptions,
          repeated HN front-page domains, and arXiv references your papers cite. Signals build over the
          first 1–2 weeks once you have enough subscriptions.
        </div>
      )}

      {rows && rows.length > 0 && filtered.length === 0 && (
        <p style={{color:'var(--fg-mute)',fontFamily:'var(--serif)',padding:'16px 0'}}>
          No discoveries match this filter.
        </p>
      )}

      {filtered.length > 0 && (
        <div style={{border:'1px solid var(--line)',borderRadius:8,overflow:'hidden'}}>
          {filtered.map((d) => (
            <DiscoveryRow
              key={d.id}
              d={d}
              busy={busyId === d.id}
              onAccept={() => void onAccept(d)}
              onSave={() => void onSave(d)}
              onDismiss={() => void onDismiss(d)}
              onBlockDomain={() => void onBlockDomain(d)}
            />
          ))}
        </div>
      )}

      {toast && (
        <div className="toast" style={{
          background: toast.tone === 'err' ? '#c53030' : toast.tone === 'ok' ? 'var(--fg)' : 'var(--bg-elev)',
          color: toast.tone === 'info' ? 'var(--fg)' : 'var(--fg-inv)',
          border: toast.tone === 'info' ? '1px solid var(--line)' : 'none',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span>{toast.text}</span>
          {toast.onUndo && (
            <button
              onClick={() => { toast.onUndo?.(); setToast(null); }}
              style={{
                background:'transparent', border:'1px solid var(--line)',
                color:'inherit', fontFamily:'var(--mono)', fontSize:11,
                padding:'2px 8px', borderRadius:4, cursor:'pointer',
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DiscoveryRow({ d, busy, onAccept, onSave, onDismiss, onBlockDomain }: {
  d: Discovery;
  busy: boolean;
  onAccept: () => void;
  onSave: () => void;
  onDismiss: () => void;
  onBlockDomain: () => void;
}) {
  const truncatedPaths = d.trust_paths.slice(0, 3);
  const extraPaths = d.trust_paths.length - truncatedPaths.length;
  return (
    <div style={{
      display:'grid',
      gridTemplateColumns:'1fr auto auto auto auto',
      gap:10,
      padding:'14px 16px',
      borderTop:'1px solid var(--line-soft)',
      alignItems:'center',
    }}>
      <div style={{overflow:'hidden'}}>
        <div style={{fontSize:14,color:'var(--fg)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          <span style={{marginRight:8,color:'var(--fg-faint)'}}>{kindIcon(d.kind)}</span>
          {d.title || d.url}
        </div>
        <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--fg-faint)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          <a href={d.url} target="_blank" rel="noreferrer" style={{color:'inherit'}}>{d.url}</a>
        </div>
        <div style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--fg-faint)',marginTop:5,lineHeight:1.55}}>
          <div>
            {kindLabel(d.kind)} · confluence {d.confluence}
            {d.llm_score != null && ` · score ${d.llm_score}/10`}
          </div>
          {truncatedPaths.map((p, i) => (
            <div key={i}>· {p.snippet}</div>
          ))}
          {extraPaths > 0 && <div>· +{extraPaths} more</div>}
        </div>
      </div>
      <button onClick={onAccept} disabled={busy} style={btnGhost()}
              title="Subscribe to this source via the Subscriptions resolver">
        Subscribe
      </button>
      <button onClick={onSave} disabled={busy} style={btnGhost()}
              title="Ingest this URL once">
        Save
      </button>
      <button onClick={onDismiss} disabled={busy} style={btnGhost()}>
        Dismiss
      </button>
      <button onClick={onBlockDomain} disabled={busy} style={btnGhost('danger')}
              title={`Never surface ${d.domain} again`}>
        Block domain
      </button>
    </div>
  );
}

function FilterPills({ filter, setFilter, rows }: {
  filter: Filter;
  setFilter: (f: Filter) => void;
  rows: Discovery[];
}) {
  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: rows.length,
      co_citation: 0, substack_rec: 0, hn_domain: 0, arxiv_paper: 0,
    };
    for (const r of rows) c[r.kind] += 1;
    return c;
  }, [rows]);
  const Pill = ({ k, label }: { k: Filter; label: string }) => (
    <button
      onClick={() => setFilter(k)}
      style={{
        padding: '6px 12px', borderRadius: 999,
        border: '1px solid var(--line)',
        background: filter === k ? 'var(--bg-sunk)' : 'transparent',
        color: filter === k ? 'var(--fg)' : 'var(--fg-mute)',
        fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
      }}
    >
      {label} <span style={{ opacity: 0.6, marginLeft: 4 }}>{counts[k]}</span>
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Pill k="all" label="all" />
      <Pill k="co_citation" label="co-citation" />
      <Pill k="substack_rec" label="substack" />
      <Pill k="hn_domain" label="hn" />
      <Pill k="arxiv_paper" label="arxiv" />
    </div>
  );
}

function kindIcon(k: DiscoveryKind): string {
  if (k === 'co_citation') return '◆';
  if (k === 'substack_rec') return '✉';
  if (k === 'hn_domain') return '⊕';
  if (k === 'arxiv_paper') return '◇';
  return '·';
}
function kindLabel(k: DiscoveryKind): string {
  if (k === 'co_citation') return 'co-citation';
  if (k === 'substack_rec') return 'substack rec';
  if (k === 'hn_domain') return 'hn domain';
  if (k === 'arxiv_paper') return 'arxiv ref';
  return k;
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: '10px 18px',
    borderRadius: 6,
    background: disabled ? 'var(--bg-sunk)' : 'var(--accent)',
    color: disabled ? 'var(--fg-faint)' : 'var(--fg-inv)',
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: 'none',
  };
}

function btnGhost(tone: 'normal' | 'danger' = 'normal'): React.CSSProperties {
  return {
    padding: '7px 12px',
    borderRadius: 5,
    background: 'transparent',
    color: tone === 'danger' ? 'var(--fg-mute)' : 'var(--fg)',
    fontSize: 12,
    border: '1px solid var(--line)',
    cursor: 'pointer',
  };
}

import { useState } from 'react';
import type { VaultItem, PinnedItem, UserInfo, View } from '../types';

interface Props {
  vault: VaultItem[];
  pinned: PinnedItem[];
  user: UserInfo | null;
  currentView: View;
  currentArticle: string;
  onNavigate: (view: View, id?: string) => void;
}

const SYS_VIEWS = new Set<View>(['digest', 'queue', 'feed', 'agents', 'graph', 'ingest', 'lint', 'settings', 'open_questions']);

export function Sidebar({ vault, pinned, user, currentView, currentArticle, onNavigate }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setCollapsed((s) => ({ ...s, [k]: !s[k] }));

  return (
    <aside className="sidebar">
      {pinned.length > 0 && (
        <>
          <div className="side-section">Pinned</div>
          <div className="side-pin-section">
            {pinned.map((p) => (
              <div key={p.id} className="side-pin" onClick={() => onNavigate('article', p.id)}>
                <div className="dot"/><span>{p.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {vault.map((item, i) => {
        if (item.kind === 'section') return <div key={i} className="side-section">{item.label}</div>;
        if (item.kind === 'folder') {
          const open = !collapsed[item.label];
          return (
            <div key={i}>
              <div className={`side-folder ${open ? '' : 'collapsed'}`} onClick={() => toggle(item.label)}>
                <span className="chev">▾</span><span>{item.label}</span><span className="count">{item.count}</span>
              </div>
              {open && (
                <div className="side-children">
                  {item.children.map((c) => <Row key={c.id} item={c} currentArticle={currentArticle} currentView={currentView} onNavigate={onNavigate} />)}
                </div>
              )}
            </div>
          );
        }
        return <Row key={item.id} item={item} currentArticle={currentArticle} currentView={currentView} onNavigate={onNavigate} />;
      })}
      {user && (
        <div className="user-pill" onClick={() => onNavigate('ingest')} role="button" title="Sources & ingest">
          <div className="user-avatar">{user.initials}</div>
          <div className="user-meta">
            <div className="user-name">{user.name}</div>
            <div className="user-sub">
              {user.stats.pages} {user.stats.pages === 1 ? 'page' : 'pages'}
              {user.stats.sources > 0 && ` · ${user.stats.sources} sources`}
              {user.stats.feeds > 0 && ` · ${user.stats.feeds} feeds`}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function Row({ item, currentArticle, currentView, onNavigate }: { item: any; currentArticle: string; currentView: View; onNavigate: Props['onNavigate']; }) {
  const active = item.id === currentArticle || (item.id && item.id === currentView);
  const click = () => {
    if (SYS_VIEWS.has(item.id)) onNavigate(item.id as View);
    else onNavigate('article', item.id);
  };
  return (
    <div className={`side-row ${active ? 'active' : ''}`} onClick={click}>
      <span className="glyph">{item.glyph}</span>
      <span className="label">{item.label}</span>
      {item.badge && <span className={`badge ${item.badge === 'live' ? 'live' : ''}`}>{item.badge}</span>}
      {item.hot && <span style={{color:'var(--accent)', fontSize:8}}>●</span>}
    </div>
  );
}

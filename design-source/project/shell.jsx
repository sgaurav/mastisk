/* global React, MASTISK_DATA */
const { useState, useEffect, useRef, useMemo } = React;

// ─── Icons ───────────────────────────────────────────────
const Icon = {
  search: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  sun: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  moon: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 9.5A6 6 0 016.5 2.5a6 6 0 107 7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>,
  spark: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1l1.8 4.2L14 7l-4.2 1.8L8 13l-1.8-4.2L2 7l4.2-1.8L8 1z" fill="currentColor"/></svg>,
  graph: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="3" cy="8" r="2" stroke="currentColor" strokeWidth="1.4"/><circle cx="13" cy="3" r="2" stroke="currentColor" strokeWidth="1.4"/><circle cx="13" cy="13" r="2" stroke="currentColor" strokeWidth="1.4"/><path d="M5 7l6-3M5 9l6 3" stroke="currentColor" strokeWidth="1.4"/></svg>,
  panel: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M10 2v12" stroke="currentColor" strokeWidth="1.3"/></svg>,
  ask: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H6l-3 3v-3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>,
  expand: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8 2v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
  link: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M7 9a3 3 0 004 0l2-2a3 3 0 00-4-4l-1 1M9 7a3 3 0 00-4 0l-2 2a3 3 0 004 4l1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  arrow: <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  close: <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
};

// ─── Titlebar ───────────────────────────────────────────────
function Titlebar({ view, theme, onTheme, onToggleSide, onToggleRail, onAsk }) {
  const crumb = {
    digest: ['Today', 'Daily Digest'],
    article: ['Wiki', 'Concepts', 'Test-time compute'],
    feed: ['Today', 'Agent feed'],
    agents: ['System', 'Agents'],
    graph: ['System', 'Graph view'],
    mobile: ['System', 'Mobile companion'],
  }[view] || ['Wiki'];

  return (
    <div className="titlebar">
      <div className="tb-dots"><div className="tb-dot r"/><div className="tb-dot y"/><div className="tb-dot g"/></div>
      <div className="tb-crumb">
        <span style={{color:'var(--fg-mute)'}}>mastisk</span>
        {crumb.map((c, i) => <React.Fragment key={i}><span className="sep">/</span><span>{c}</span></React.Fragment>)}
      </div>
      <div className="tb-search">
        {Icon.search}
        <span style={{flex:1}}>Search wiki, ask, jump to page…</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="tb-actions">
        <button className="tb-btn" onClick={onAsk} title="Ask Mastisk">{Icon.ask}</button>
        <button className="tb-btn" onClick={onToggleSide} title="Toggle sidebar">{Icon.panel}</button>
        <button className="tb-btn" onClick={onToggleRail} title="Toggle right rail" style={{transform:'scaleX(-1)'}}>{Icon.panel}</button>
        <button className="tb-btn" onClick={onTheme} title="Toggle theme">
          {theme === 'dark' ? Icon.sun : Icon.moon}
        </button>
      </div>
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────────
function Sidebar({ vault, pinned, currentView, currentArticle, onNavigate }) {
  const [collapsed, setCollapsed] = useState({});
  const tog = (k) => setCollapsed(s => ({ ...s, [k]: !s[k] }));

  return (
    <aside className="sidebar">
      {pinned && pinned.length > 0 && (
        <>
          <div className="side-section">Pinned</div>
          <div className="side-pin-section">
            {pinned.map(p => (
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
              <div className={`side-folder ${open ? '' : 'collapsed'}`} onClick={() => tog(item.label)}>
                <span className="chev">▾</span><span>{item.label}</span><span className="count">{item.count}</span>
              </div>
              {open && <div className="side-children">{item.children.map(c => row(c, currentArticle, currentView, onNavigate))}</div>}
            </div>
          );
        }
        return row(item, currentArticle, currentView, onNavigate);
      })}
      <div className="user-pill">
        <div className="user-avatar">{MASTISK_DATA.user.initials}</div>
        <div className="user-meta">
          <div className="user-name">{MASTISK_DATA.user.name}</div>
          <div className="user-sub">1,247 sources · 522 pages</div>
        </div>
      </div>
    </aside>
  );

  function row(item, currentArticle, currentView, onNavigate) {
    const active = item.id === currentArticle || (item.id && item.id === currentView);
    const click = () => {
      const sysViews = ['digest','queue','feed','agents','graph','ingest','lint'];
      if (sysViews.includes(item.id)) onNavigate(item.id);
      else onNavigate('article', item.id);
    };
    return (
      <div key={item.id} className={`side-row ${active ? 'active' : ''}`} onClick={click}>
        <span className="glyph">{item.glyph}</span>
        <span className="label">{item.label}</span>
        {item.badge && <span className={`badge ${item.badge === 'live' ? 'live' : ''}`}>{item.badge}</span>}
        {item.hot && <span style={{color:'var(--accent)', fontSize:8}}>●</span>}
      </div>
    );
  }
}

Object.assign(window, { Icon, Titlebar, Sidebar });

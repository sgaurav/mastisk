import { Icon } from './icons';
import type { View } from '../types';

const CRUMB: Record<string, readonly string[]> = {
  digest:  ['Today',  'Daily Digest'],
  article: ['Wiki',   'Concepts'],
  feed:    ['Today',  'Agent feed'],
  agents:  ['System', 'Agents'],
  graph:   ['System', 'Graph view'],
  mobile:  ['System', 'Mobile companion'],
  queue:   ['Today',  'Reading queue'],
  open_questions: ['Today', 'Open questions'],
  ingest:  ['System', 'Sources & ingest'],
  lint:    ['System', 'Health check'],
  settings:['System', 'Settings'],
  blog:       ['Wiki', 'Blog Posts'],
  blog_post:  ['Wiki', 'Blog Posts', 'Draft'],
};

interface Props {
  view: View;
  articleTitle?: string;
  articleKind?: string;
  theme: 'light' | 'dark';
  onTheme: () => void;
  onToggleSide: () => void;
  onToggleRail: () => void;
  onAsk: () => void;
  onCapture?: () => void;
  onSearchClick: () => void;
}

const KIND_PLURAL: Record<string, string> = {
  Concept: 'Concepts',
  Entity: 'Entities',
  Source: 'Sources',
  Synthesis: 'Synthesis',
};

function buildCrumb(view: View, articleTitle?: string, articleKind?: string): string[] {
  const base = CRUMB[view] ?? ['Wiki'];
  // Copy — never mutate the module-level const
  const crumb = [...base];
  if (view === 'article') {
    if (articleKind && KIND_PLURAL[articleKind]) crumb[1] = KIND_PLURAL[articleKind];
    if (articleTitle) crumb.push(articleTitle);
  }
  return crumb.filter(Boolean);
}

export function Titlebar({ view, articleTitle, articleKind, theme, onTheme, onToggleSide, onToggleRail, onAsk, onCapture, onSearchClick }: Props) {
  const crumb = buildCrumb(view, articleTitle, articleKind);

  return (
    <div className="titlebar">
      <div className="tb-crumb">
        <span style={{color:'var(--fg-mute)'}}>mastisk</span>
        {crumb.map((c, i) => (
          <span key={`${view}-${i}-${c}`}>
            <span className="sep"> / </span>{c}
          </span>
        ))}
      </div>
      <div className="tb-search" onClick={onSearchClick} role="button">
        {Icon.search}
        <span style={{flex:1}}>Search wiki, ask, jump to page…</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="tb-actions">
        <button className="tb-btn" onClick={onCapture} title="New note (⌘+)">+</button>
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

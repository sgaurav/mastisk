import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useFeedStream } from './stream';
import type {
  Article, AgentInfo, Digest, FeedTick, PinnedItem, VaultItem, View,
} from './types';

import { Titlebar } from './components/Titlebar';
import { Sidebar } from './components/Sidebar';
import { ArticleView } from './components/ArticleView';
import { RightRail } from './components/RightRail';
import { SystemRail } from './components/SystemRail';
import { DigestView } from './components/DigestView';
import { AgentsView } from './components/AgentsView';
import { GraphView } from './components/GraphView';
import { AskDrawer } from './components/AskDrawer';

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (localStorage.getItem('mk-theme') as 'light' | 'dark') || 'light',
  );
  const [view, setView] = useState<View>(
    (localStorage.getItem('mk-view') as View) || 'article',
  );
  const [currentArticle, setCurrentArticle] = useState<string>(
    localStorage.getItem('mk-article') || 'ttc',
  );
  const [sideOpen, setSideOpen] = useState(window.innerWidth > 900);
  const [railOpen, setRailOpen] = useState(window.innerWidth > 900);
  const [askOpen, setAskOpen] = useState(false);
  const [askCtx, setAskCtx] = useState<{ prompt: string; selection: string | null; article_id?: string } | null>(null);

  // Data
  const [sidebar, setSidebar] = useState<{ vault: VaultItem[]; pinned: PinnedItem[] } | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [feed, setFeed] = useState<FeedTick[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  // Live feed
  const { rows: liveRows } = useFeedStream<FeedTick>([]);
  const mergedFeed: FeedTick[] = [...liveRows, ...feed];

  // Persist view state
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mk-theme', theme);
  }, [theme]);
  useEffect(() => { localStorage.setItem('mk-view', view); }, [view]);
  useEffect(() => { localStorage.setItem('mk-article', currentArticle); }, [currentArticle]);

  // Initial fetches
  useEffect(() => {
    void api.sidebar().then(setSidebar).catch(console.error);
    void api.feed().then((d) => { setFeed(d.feed); setAgents(d.agents); }).catch(console.error);
    void api.digest().then(setDigest).catch(console.error);
  }, []);

  // Article fetch on selection change. If the article is missing (fresh install),
  // flip to the Digest so the user sees something useful instead of "loading…".
  useEffect(() => {
    if (!currentArticle) return;
    api.article(currentArticle)
      .then(setArticle)
      .catch(() => {
        setArticle(null);
        if (view === 'article') setView('digest');
      });
  }, [currentArticle]);

  const navigate = useCallback((v: View, id?: string) => {
    setView(v);
    if (v === 'article' && id) setCurrentArticle(id);
    // Mobile: close sidebar after navigation
    if (window.innerWidth <= 900) setSideOpen(false);
  }, []);

  const openAsk = useCallback((prompt: string, selection: string | null) => {
    setAskCtx({ prompt, selection, article_id: currentArticle });
    setAskOpen(true);
  }, [currentArticle]);

  return (
    <div className="app" data-rail={railOpen ? 'open' : 'closed'} data-side={sideOpen ? 'open' : 'closed'}>
      <Titlebar
        view={view}
        articleTitle={article?.title}
        articleKind={article?.kind}
        theme={theme}
        onTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onToggleSide={() => setSideOpen((s) => !s)}
        onToggleRail={() => setRailOpen((s) => !s)}
        onAsk={() => openAsk("What's most important in my wiki right now?", null)}
        onSearchClick={() => openAsk("", null)}
      />

      {sideOpen && sidebar && (
        <Sidebar
          vault={sidebar.vault}
          pinned={sidebar.pinned}
          userName="Mastisk"
          userSub={`${sidebar.vault.reduce((n, v) => n + (v.kind === 'folder' ? v.count : 0), 0)} pages`}
          currentView={view}
          currentArticle={currentArticle}
          onNavigate={navigate}
        />
      )}

      <main className="main">
        {view === 'article' && article && <ArticleView article={article} onAsk={openAsk} onNavigate={navigate}/>}
        {view === 'article' && !article && <Loading/>}
        {view === 'digest' && digest && <DigestView digest={digest} onNavigate={navigate} onAsk={openAsk}/>}
        {view === 'digest' && !digest && <Loading/>}
        {(view === 'feed' || view === 'agents') && <AgentsView agents={agents} feed={mergedFeed}/>}
        {view === 'graph' && <GraphView onNavigate={navigate}/>}
        {['queue', 'ingest', 'lint', 'mobile'].includes(view) && (
          <div className="view">
            <div className="view-h">System</div>
            <h1 className="view-title">Coming soon</h1>
            <p className="view-sub">This view isn't built out in the prototype yet. Pick a different item in the sidebar.</p>
          </div>
        )}
      </main>

      {railOpen && view === 'article' && article && (
        <RightRail article={article} feed={mergedFeed} agents={agents} onAsk={openAsk} onNavigate={navigate}/>
      )}
      {railOpen && view !== 'article' && (
        <SystemRail view={view} feed={mergedFeed} agents={agents} onNavigate={navigate}/>
      )}

      <AskDrawer open={askOpen} ctx={askCtx} onClose={() => setAskOpen(false)}/>
    </div>
  );
}

function Loading() {
  return (
    <div className="view">
      <p style={{color:'var(--fg-faint)',fontFamily:'var(--mono)',fontSize:12}}>loading…</p>
    </div>
  );
}

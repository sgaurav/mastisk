import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useRoute } from './router';
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
import { IngestView } from './components/IngestView';
import { QueueView } from './components/QueueView';
import { SystemCheckView } from './components/SystemCheckView';

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (localStorage.getItem('mk-theme') as 'light' | 'dark') || 'light',
  );

  const { route, navigate: routeNavigate, replace } = useRoute();
  const { view, articleId: currentArticle } = route;

  const [sideOpen, setSideOpen] = useState(window.innerWidth > 900);
  const [railOpen, setRailOpen] = useState(window.innerWidth > 900);
  const [askOpen, setAskOpen] = useState(false);
  const [askCtx, setAskCtx] = useState<{ prompt: string; selection: string | null; article_id?: string } | null>(null);

  const [sidebar, setSidebar] = useState<{ vault: VaultItem[]; pinned: PinnedItem[]; user: import('./types').UserInfo } | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [feed, setFeed] = useState<FeedTick[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  const { rows: liveRows } = useFeedStream<FeedTick>([]);
  const mergedFeed: FeedTick[] = [...liveRows, ...feed];

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mk-theme', theme);
  }, [theme]);

  useEffect(() => {
    void api.sidebar().then(setSidebar).catch(console.error);
    void api.feed().then((d) => { setFeed(d.feed); setAgents(d.agents); }).catch(console.error);
    void api.digest().then(setDigest).catch(console.error);
  }, []);

  // Refresh sidebar counts + digest whenever agents emit a new tick, so the
  // "Concepts 1 → 2" counter updates as articles are compiled without a reload.
  // Also polls on a 30s floor as a safety net in case the SSE stream drops.
  const tickKey = liveRows[0] ? `${(liveRows[0] as FeedTick).t}-${liveRows.length}` : '';
  useEffect(() => {
    if (!tickKey) return;
    void api.sidebar().then(setSidebar).catch(() => {});
    void api.digest().then(setDigest).catch(() => {});
  }, [tickKey]);
  useEffect(() => {
    const id = setInterval(() => {
      void api.sidebar().then(setSidebar).catch(() => {});
      void api.digest().then(setDigest).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, []);

  // Load the article whenever the route points at one. On 404, bounce to the
  // digest so a dead deep-link doesn't leave the user staring at "loading…".
  useEffect(() => {
    if (view !== 'article' || !currentArticle) {
      setArticle(null);
      return;
    }
    api.article(currentArticle)
      .then(setArticle)
      .catch(() => {
        setArticle(null);
        replace('digest');
      });
  }, [view, currentArticle, replace]);

  const navigate = useCallback((v: View, id?: string) => {
    routeNavigate(v, id);
    if (window.innerWidth <= 900) setSideOpen(false);
  }, [routeNavigate]);

  const openAsk = useCallback((prompt: string, selection: string | null) => {
    setAskCtx({ prompt, selection, article_id: currentArticle ?? undefined });
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
          user={sidebar.user}
          currentView={view}
          currentArticle={currentArticle ?? ''}
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
        {view === 'ingest' && <IngestView/>}
        {view === 'queue' && <QueueView/>}
        {view === 'lint' && <SystemCheckView/>}
        {view === 'mobile' && (
          <div className="view">
            <div className="view-h">System</div>
            <h1 className="view-title">Mobile companion</h1>
            <p className="view-sub">
              Open Mastisk on your phone via the Tailnet URL (run <code>mastisk url</code>)
              and tap Share → Add to Home Screen. The full reader runs as a PWA.
            </p>
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

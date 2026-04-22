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
import { OpenQuestionsView } from './components/OpenQuestionsView';
import { QueueView } from './components/QueueView';
import { SettingsView } from './components/SettingsView';
import { SystemCheckView } from './components/SystemCheckView';
import { WikiLinkHoverProvider } from './components/WikiLinkHover';
import { NotesView } from './components/NotesView';
import { NoteView } from './components/NoteView';
import { NoteCaptureModal } from './components/NoteCaptureModal';
import { RoundtablesListView } from './components/RoundtablesListView';
import { RoundtableView } from './components/RoundtableView';
import { ReposView } from './components/ReposView';
import { RepoDetailView } from './components/RepoDetailView';

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    (localStorage.getItem('mk-theme') as 'light' | 'dark') || 'light',
  );

  const { route, navigate: routeNavigate, replace } = useRoute();
  const { view, articleId: currentArticle, noteId: currentNote, date: currentDate } = route;
  const currentRoundtable = route.roundtableId;

  const [sideOpen, setSideOpen] = useState(window.innerWidth > 900);
  const [railOpen, setRailOpen] = useState(window.innerWidth > 900);
  const [askOpen, setAskOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [askCtx, setAskCtx] = useState<{ prompt: string; selection: string | null; article_id?: string } | null>(null);

  const [sidebar, setSidebar] = useState<{ vault: VaultItem[]; pinned: PinnedItem[]; user: import('./types').UserInfo } | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [feed, setFeed] = useState<FeedTick[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [toast, setToast] = useState<{ msg: string; noteId: number } | null>(null);

  const { rows: liveRows } = useFeedStream<FeedTick>([]);
  const mergedFeed: FeedTick[] = [...liveRows, ...feed];

  // Watch for escalator/auto-escalated feed rows and surface a toast so the
  // user knows a background research job just kicked off on one of their notes.
  const liveEscalations = liveRows.filter(
    (r) => (r as FeedTick).agent === 'escalator' && (r as FeedTick).verb === 'auto-escalated',
  );
  const lastEscalation = liveEscalations[0];
  useEffect(() => {
    if (!lastEscalation) return;
    const tick = lastEscalation as FeedTick;
    const payload = tick.payload_json
      ? (() => { try { return JSON.parse(tick.payload_json!); } catch { return {}; } })()
      : {};
    const title = (payload as { title?: string }).title ?? 'note';
    const noteId = Number(tick.obj);
    if (!Number.isFinite(noteId)) return;
    setToast({ msg: `Auto-researching: ${title}`, noteId });
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [lastEscalation]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mk-theme', theme);
  }, [theme]);

  useEffect(() => {
    void api.sidebar().then(setSidebar).catch(console.error);
    void api.feed().then((d) => { setFeed(d.feed); setAgents(d.agents); }).catch(console.error);
  }, []);

  // Re-fetch the digest whenever the requested date changes (null = today).
  useEffect(() => {
    setDigest(null);
    void api.digest(currentDate ?? undefined).then(setDigest).catch(console.error);
  }, [currentDate]);

  // Refresh sidebar counts + digest whenever agents emit a new tick, so the
  // "Concepts 1 → 2" counter updates as articles are compiled without a reload.
  // Also polls on a 30s floor as a safety net in case the SSE stream drops.
  const tickKey = liveRows[0] ? `${(liveRows[0] as FeedTick).t}-${liveRows.length}` : '';
  useEffect(() => {
    if (!tickKey) return;
    void api.sidebar().then(setSidebar).catch(() => {});
    void api.digest(currentDate ?? undefined).then(setDigest).catch(() => {});
  }, [tickKey, currentDate]);
  useEffect(() => {
    const id = setInterval(() => {
      void api.sidebar().then(setSidebar).catch(() => {});
      void api.digest(currentDate ?? undefined).then(setDigest).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, [currentDate]);

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
        onCapture={() => setCaptureOpen(true)}
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
        {view === 'open_questions' && <OpenQuestionsView onNavigate={navigate}/>}
        {view === 'queue' && <QueueView onNavigate={navigate}/>}
        {view === 'lint' && <SystemCheckView/>}
        {view === 'settings' && <SettingsView/>}
        {view === 'notes' && <NotesView onNavigate={navigate}/>}
        {view === 'note' && currentNote !== null && <NoteView noteId={currentNote} onNavigate={navigate}/>}
        {view === 'roundtables' && <RoundtablesListView onNavigate={navigate}/>}
        {view === 'roundtable' && currentRoundtable !== null && (
          <RoundtableView roundtableId={currentRoundtable} onNavigate={navigate}/>
        )}
        {view === 'repos' && <ReposView onNavigate={navigate}/>}
        {view === 'repo' && route.repoSlug && <RepoDetailView slug={route.repoSlug} onNavigate={navigate}/>}
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
        <SystemRail
          view={view}
          feed={mergedFeed}
          agents={agents}
          selectedDate={digest?.iso_date ?? null}
          onNavigate={navigate}
        />
      )}

      <AskDrawer open={askOpen} ctx={askCtx} onClose={() => setAskOpen(false)}/>
      <NoteCaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onCaptured={(id) => navigate('note', String(id))}
      />
      {toast && (
        <div
          role="status"
          onClick={() => { navigate('note', String(toast.noteId)); setToast(null); }}
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 1100,
            background: 'var(--bg)', border: '1px solid var(--border)',
            padding: '8px 12px', borderRadius: 6,
            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            cursor: 'pointer', fontSize: 13, maxWidth: 320,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--mono)', marginBottom: 2 }}>
            auto-escalated
          </div>
          {toast.msg}
        </div>
      )}
      <WikiLinkHoverProvider/>
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

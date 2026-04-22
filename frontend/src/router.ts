import { useCallback, useEffect, useState } from 'react';
import type { View } from './types';

export interface Route {
  view: View;
  articleId: string | null;
  noteId: number | null;
  date: string | null;
}

const VIEW_PATHS: Record<string, View> = {
  '': 'digest',
  '/': 'digest',
  '/digest': 'digest',
  '/queue': 'queue',
  '/feed': 'feed',
  '/agents': 'agents',
  '/graph': 'graph',
  '/ingest': 'ingest',
  '/health': 'lint',
  '/lint': 'lint',
  '/mobile': 'mobile',
  '/open-questions': 'open_questions',
  '/settings': 'settings',
  '/notes': 'notes',
};

const PATH_FOR_VIEW: Record<View, string> = {
  article: '/a/',
  digest: '/',
  queue: '/queue',
  feed: '/feed',
  agents: '/agents',
  graph: '/graph',
  ingest: '/ingest',
  lint: '/health',
  mobile: '/mobile',
  open_questions: '/open-questions',
  settings: '/settings',
  notes: '/notes',
  note: '/notes/',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseRoute(pathname: string): Route {
  if (pathname.startsWith('/a/')) {
    const raw = pathname.slice(3).split('/')[0];
    if (raw) return { view: 'article', articleId: decodeURIComponent(raw), noteId: null, date: null };
  }
  if (pathname.startsWith('/digest/')) {
    const raw = pathname.slice('/digest/'.length).split('/')[0];
    if (raw && ISO_DATE.test(raw)) {
      return { view: 'digest', articleId: null, noteId: null, date: raw };
    }
    // Malformed date — fall through to today's digest.
    return { view: 'digest', articleId: null, noteId: null, date: null };
  }
  if (pathname.startsWith('/notes/')) {
    const raw = pathname.slice('/notes/'.length).split('/')[0];
    const id = Number(raw);
    if (raw && Number.isFinite(id) && id > 0) {
      return { view: 'note', articleId: null, noteId: id, date: null };
    }
    return { view: 'notes', articleId: null, noteId: null, date: null };
  }
  const view = VIEW_PATHS[pathname];
  if (view) return { view, articleId: null, noteId: null, date: null };
  return { view: 'digest', articleId: null, noteId: null, date: null };
}

export function routeToPath(view: View, arg?: string | null): string {
  if (view === 'article' && arg) return `/a/${encodeURIComponent(arg)}`;
  if (view === 'digest' && arg && ISO_DATE.test(arg)) return `/digest/${arg}`;
  if (view === 'note' && arg) return `/notes/${arg}`;
  return PATH_FOR_VIEW[view] ?? '/';
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((view: View, arg?: string) => {
    const path = routeToPath(view, arg);
    if (path !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', path);
    }
    const next: Route = { view, articleId: null, noteId: null, date: null };
    if (view === 'article' && arg) next.articleId = arg;
    else if (view === 'digest' && arg && ISO_DATE.test(arg)) next.date = arg;
    else if (view === 'note' && arg) next.noteId = Number(arg);
    setRoute(next);
  }, []);

  const replace = useCallback((view: View, arg?: string) => {
    const path = routeToPath(view, arg);
    window.history.replaceState(null, '', path);
    const next: Route = { view, articleId: null, noteId: null, date: null };
    if (view === 'article' && arg) next.articleId = arg;
    else if (view === 'digest' && arg && ISO_DATE.test(arg)) next.date = arg;
    else if (view === 'note' && arg) next.noteId = Number(arg);
    setRoute(next);
  }, []);

  return { route, navigate, replace };
}

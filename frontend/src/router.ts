import { useCallback, useEffect, useState } from 'react';
import type { View } from './types';

export interface Route {
  view: View;
  articleId: string | null;
  noteId: number | null;
  roundtableId: number | null;
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
  '/roundtables': 'roundtables',
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
  roundtables: '/roundtables',
  roundtable: '/roundtables/',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function emptyRoute(view: View): Route {
  return { view, articleId: null, noteId: null, roundtableId: null, date: null };
}

export function parseRoute(pathname: string): Route {
  if (pathname.startsWith('/a/')) {
    const raw = pathname.slice(3).split('/')[0];
    if (raw) return { ...emptyRoute('article'), articleId: decodeURIComponent(raw) };
  }
  if (pathname.startsWith('/digest/')) {
    const raw = pathname.slice('/digest/'.length).split('/')[0];
    if (raw && ISO_DATE.test(raw)) {
      return { ...emptyRoute('digest'), date: raw };
    }
    // Malformed date — fall through to today's digest.
    return emptyRoute('digest');
  }
  if (pathname.startsWith('/notes/')) {
    const raw = pathname.slice('/notes/'.length).split('/')[0];
    const id = Number(raw);
    if (raw && Number.isFinite(id) && id > 0) {
      return { ...emptyRoute('note'), noteId: id };
    }
    return emptyRoute('notes');
  }
  if (pathname.startsWith('/roundtables/')) {
    const raw = pathname.slice('/roundtables/'.length).split('/')[0];
    const id = Number(raw);
    if (raw && Number.isFinite(id) && id > 0) {
      return { ...emptyRoute('roundtable'), roundtableId: id };
    }
    return emptyRoute('roundtables');
  }
  const view = VIEW_PATHS[pathname];
  if (view) return emptyRoute(view);
  return emptyRoute('digest');
}

export function routeToPath(view: View, arg?: string | null): string {
  if (view === 'article' && arg) return `/a/${encodeURIComponent(arg)}`;
  if (view === 'digest' && arg && ISO_DATE.test(arg)) return `/digest/${arg}`;
  if (view === 'note' && arg) return `/notes/${arg}`;
  if (view === 'roundtable' && arg) return `/roundtables/${arg}`;
  return PATH_FOR_VIEW[view] ?? '/';
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const buildRoute = (view: View, arg?: string): Route => {
    const next = emptyRoute(view);
    if (view === 'article' && arg) next.articleId = arg;
    else if (view === 'digest' && arg && ISO_DATE.test(arg)) next.date = arg;
    else if (view === 'note' && arg) next.noteId = Number(arg);
    else if (view === 'roundtable' && arg) next.roundtableId = Number(arg);
    return next;
  };

  const navigate = useCallback((view: View, arg?: string) => {
    const path = routeToPath(view, arg);
    if (path !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', path);
    }
    setRoute(buildRoute(view, arg));
  }, []);

  const replace = useCallback((view: View, arg?: string) => {
    const path = routeToPath(view, arg);
    window.history.replaceState(null, '', path);
    setRoute(buildRoute(view, arg));
  }, []);

  return { route, navigate, replace };
}

import { useCallback, useEffect, useState } from 'react';
import type { View } from './types';

export interface Route {
  view: View;
  articleId: string | null;
}

const VIEW_PATHS: Record<string, View> = {
  '': 'digest',
  '/': 'digest',
  '/queue': 'queue',
  '/feed': 'feed',
  '/agents': 'agents',
  '/graph': 'graph',
  '/ingest': 'ingest',
  '/health': 'lint',
  '/lint': 'lint',
  '/mobile': 'mobile',
  '/settings': 'settings',
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
  settings: '/settings',
};

export function parseRoute(pathname: string): Route {
  if (pathname.startsWith('/a/')) {
    const raw = pathname.slice(3).split('/')[0];
    if (raw) return { view: 'article', articleId: decodeURIComponent(raw) };
  }
  const view = VIEW_PATHS[pathname];
  if (view) return { view, articleId: null };
  return { view: 'digest', articleId: null };
}

export function routeToPath(view: View, articleId?: string | null): string {
  if (view === 'article' && articleId) return `/a/${encodeURIComponent(articleId)}`;
  return PATH_FOR_VIEW[view] ?? '/';
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((view: View, articleId?: string) => {
    const path = routeToPath(view, articleId);
    if (path !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', path);
    }
    setRoute({ view, articleId: articleId ?? null });
  }, []);

  const replace = useCallback((view: View, articleId?: string) => {
    const path = routeToPath(view, articleId);
    window.history.replaceState(null, '', path);
    setRoute({ view, articleId: articleId ?? null });
  }, []);

  return { route, navigate, replace };
}

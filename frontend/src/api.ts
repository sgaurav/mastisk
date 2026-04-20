import type { Article, AskResponse, Digest, FeedTick, AgentInfo, PinnedItem, VaultItem } from './types';

const BASE = '/api';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  sidebar: () => j<{ vault: VaultItem[]; pinned: PinnedItem[] }>(`${BASE}/sidebar`),

  article: (id: string) => j<Article>(`${BASE}/articles/${id}`),

  digest: () => j<Digest>(`${BASE}/digest`),

  feed: () => j<{ feed: FeedTick[]; agents: AgentInfo[] }>(`${BASE}/feed`),

  ask: (question: string, opts?: { selection?: string; article_id?: string }) =>
    j<AskResponse>(`${BASE}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, ...opts }),
    }),

  search: (q: string) =>
    j<{ results: { id: string; title: string; kind: string; snippet: string }[] }>(
      `${BASE}/search?q_param=${encodeURIComponent(q)}`,
    ),

  signal: (kind: string, article_id?: string | null, value?: unknown) =>
    fetch(`${BASE}/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, article_id, value }),
    }).catch(() => void 0),

  pin: (id: string) => fetch(`${BASE}/articles/${id}/pin`, { method: 'POST' }),
  unpin: (id: string) => fetch(`${BASE}/articles/${id}/pin`, { method: 'DELETE' }),

  vaultInfo: () => j<{ vault_path: string; icloud: boolean; self_files: string[] }>(`${BASE}/vault/info`),

  readSelf: (name: string) => j<{ name: string; content: string }>(`${BASE}/vault/self/${name}`),
  writeSelf: (name: string, content: string) =>
    fetch(`${BASE}/vault/self/${name}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
};

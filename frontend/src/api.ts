import type {
  Article, ArticlePreview, Artifact, ArtifactKind, AskResponse, Digest, Feed,
  FeedTick, AgentInfo, GraphData, Job, OpenQuestionsResponse, PendingSynthesisResponse,
  PinnedItem, SettingsBundle, SettingsPatch, SynthesisRunResponse, UserInfo, VaultItem,
} from './types';

const BASE = '/api';

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  sidebar: () => j<{ vault: VaultItem[]; pinned: PinnedItem[]; user: UserInfo }>(`${BASE}/sidebar`),

  graph: () => j<GraphData>(`${BASE}/graph`),

  feeds: () => j<{ feeds: Feed[] }>(`${BASE}/feeds`),
  addFeed: (url: string, title?: string) =>
    j<{ ok: boolean; feed: Feed }>(`${BASE}/feeds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, title }),
    }),
  removeFeed: (url: string) =>
    fetch(`${BASE}/feeds?url=${encodeURIComponent(url)}`, { method: 'DELETE' }),
  fetchFeedNow: (url: string) =>
    fetch(`${BASE}/feeds/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }),

  listen: async (url: string): Promise<{ job_id: number; kind: string; message: string }> => {
    const r = await fetch(`${BASE}/listen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) {
      let detail = `${r.status}`;
      try {
        const body = await r.json() as { detail?: string };
        if (body && typeof body.detail === 'string' && body.detail) detail = body.detail;
      } catch { /* ignore parse errors, fall back to status code */ }
      throw new Error(detail);
    }
    return r.json() as Promise<{ job_id: number; kind: string; message: string }>;
  },

  jobs: () => j<{ jobs: Job[] }>(`${BASE}/jobs`),

  job: (id: number) =>
    j<{ job: {
      id: number;
      agent: string;
      kind: string;
      status: 'queued' | 'running' | 'done' | 'failed';
      attempts: number;
      error: string | null;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
    } }>(`${BASE}/jobs/${id}`),

  stats: () => j<{
    counts: Record<string, number>;
    feeds_enabled: number;
    jobs: Record<string, number>;
    last_feed_fetch: string | null;
    last_agent_activity: string | null;
    self_files: Record<string, boolean>;
    vault: { path: string; icloud: boolean };
    llm: Record<string, unknown>;
  }>(`${BASE}/stats`),

  pingBridges: () => j<{
    claude: { ok: boolean; error?: string; sample?: string };
    ollama_chat: { ok: boolean; error?: string; sample?: string };
    ollama_embed: { ok: boolean; error?: string; dim?: number };
  }>(`${BASE}/stats/ping-bridges`, { method: 'POST' }),

  article: (id: string) => j<Article>(`${BASE}/articles/${id}`),

  articlePreview: (id: string) => j<ArticlePreview>(`${BASE}/articles/${id}/preview`),

  digest: (date?: string) =>
    j<Digest>(date ? `${BASE}/digest?date=${encodeURIComponent(date)}` : `${BASE}/digest`),

  openQuestions: () => j<OpenQuestionsResponse>(`${BASE}/open-questions`),

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

  artifacts: (articleId: string) =>
    j<{ artifacts: Artifact[] }>(`${BASE}/articles/${articleId}/artifacts`),

  createArtifact: (
    articleId: string,
    body: { kind: ArtifactKind; title: string; description?: string | null; spec: Record<string, unknown> },
  ) =>
    j<Artifact>(`${BASE}/articles/${articleId}/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),

  updateArtifact: (
    id: number,
    patch: { title?: string; description?: string | null; spec?: Record<string, unknown> },
  ) =>
    j<Artifact>(`${BASE}/artifacts/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  deleteArtifact: (id: number) =>
    fetch(`${BASE}/artifacts/${id}`, { method: 'DELETE' }),

  regenerateArtifacts: (articleId: string) =>
    j<{ queued: boolean; job_id?: number | string }>(
      `${BASE}/articles/${articleId}/artifacts/regenerate`,
      { method: 'POST' },
    ),

  settings: () => j<SettingsBundle>(`${BASE}/settings`),
  saveSettings: (patch: SettingsPatch) =>
    j<{ ok: boolean }>(`${BASE}/settings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),

  synthesisForArticle: (articleId: string) =>
    j<SynthesisRunResponse>(`${BASE}/synthesis/by-article/${encodeURIComponent(articleId)}`),

  pendingSynthesis: () => j<PendingSynthesisResponse>(`${BASE}/synthesis/pending`),

  acceptSynthesis: (runId: number) =>
    j<{ ok: boolean }>(`${BASE}/synthesis/${runId}/accept`, { method: 'POST' }),

  rejectSynthesis: (runId: number, feedback?: string) =>
    j<{ ok: boolean }>(`${BASE}/synthesis/${runId}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feedback: feedback ?? null }),
    }),
};

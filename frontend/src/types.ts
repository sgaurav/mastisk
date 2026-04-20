export type ArticleKind = 'Concept' | 'Entity' | 'Source' | 'Synthesis';

export interface ArticleSection {
  idx: number;
  h: string;
  body: string;
  kind: 'section' | 'callout' | 'open';
}

export interface RelatedLink {
  id: string;
  label: string;
  weight: number;
}

export interface SourceRow {
  kind: string;
  title: string;
  date: string;
}

export interface Article {
  id: string;
  kind: ArticleKind;
  title: string;
  slug: string;
  aka: string[];
  summary: string;
  body_md: string;
  confidence: number;
  readingTime: string;
  sources: number;
  backlinks: number;
  forwardlinks: number;
  sections: ArticleSection[];
  related: RelatedLink[];
  sourceList: SourceRow[];
  updated_by: string;
  updated_at: string;
  vault_path?: string;
}

export interface VaultPage {
  kind: 'page';
  id: string;
  label: string;
  glyph: string;
  badge?: string;
  hot?: boolean;
}

export interface VaultSection {
  kind: 'section';
  label: string;
}

export interface VaultFolder {
  kind: 'folder';
  label: string;
  count: number;
  children: VaultPage[];
}

export type VaultItem = VaultPage | VaultSection | VaultFolder;

export interface PinnedItem { id: string; label: string; }

export interface UserInfo {
  name: string;
  initials: string;
  stats: { pages: number; sources: number; feeds: number };
}

export interface Feed {
  url: string;
  title: string;
  last_fetched: string | null;
  last_etag: string | null;
  last_modified: string | null;
  enabled: boolean;
  added_at: string;
}

export interface JobDetail {
  title: string | null;
  subtitle: string | null;
  url: string | null;
  source_kind: string | null;
}

export interface Job {
  id: number;
  agent: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  detail: JobDetail;
}

export interface GraphNode {
  id: string;
  title: string;
  kind: string;
  color: string;
  size: number;
  degree: number;
}

export interface GraphEdge {
  from_article: string;
  to_article: string;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: { kind: string; color: string; count: number }[];
  stats: { pages: number; connections: number };
}

export interface FeedTick {
  id?: number;
  t: string;
  agent: string;
  verb: string;
  obj: string;
  touched: number;
  kind?: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'idle';
  load: number;
  color: 'amber' | 'violet' | 'emerald' | 'blue' | 'rose';
}

export interface DigestThread {
  title: string;
  body: string;
  sources: number;
  links: string[];
  article_id?: string;
}

export interface Digest {
  date: string;
  summary: string;
  counters: { label: string; value: number }[];
  threads: DigestThread[];
  queue: string[];
}

export interface AskResponse {
  answer: string;
  cites: string[];
  hits: { id: string; title: string; snippet?: string }[];
}

export type View =
  | 'article' | 'digest' | 'feed' | 'agents'
  | 'graph' | 'mobile' | 'queue' | 'ingest' | 'lint' | 'settings';

export interface BudgetValues {
  scout: number;
  listener: number;
  compiler: number;
  linter: number;
  synthesizer: number;
}

export interface SettingsValues {
  claude_cmd: string;
  ollama_local_url: string;
  ollama_local_only: boolean;
  ollama_cloud_url: string;
  ollama_cloud_key_set: boolean;
  embed_model: string;
  summarize_model_cheap: string;
  summarize_model_heavy: string;
  budget: BudgetValues;
}

export interface SettingsBundle {
  values: SettingsValues;
  model_roles: Record<string, string>;
  config_path: string;
  cloud_active: boolean;
}

export interface SettingsPatch {
  claude_cmd?: string;
  ollama_local_url?: string;
  ollama_local_only?: boolean;
  ollama_cloud_url?: string;
  ollama_cloud_key?: string;  // "" clears, non-empty sets, omit to leave
  embed_model?: string;
  summarize_model_cheap?: string;
  summarize_model_heavy?: string;
  budget?: BudgetValues;
}

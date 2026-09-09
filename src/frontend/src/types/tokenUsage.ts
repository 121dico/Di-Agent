/** 原生输入含缓存；缓存、推理分别是输入、输出的子集。缺省表示未知。 */
export interface TokenUsage {
  context_events?: { id: string; kind: string; status: string; started_at?: string; ended_at?: string }[];
  provider: string;
  source: 'actual';
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
  context_tokens?: number;
  context_window_tokens?: number;
  complete: boolean;
  observed_at?: string;
}

export function isTokenUsage(value: unknown): value is TokenUsage {
  if (!value || typeof value !== 'object') return false;
  const u = value as Partial<TokenUsage>;
  if (u.source !== 'actual' || !['codex', 'claude'].includes(u.provider ?? '') || !u.observed_at || !Number.isFinite(Date.parse(u.observed_at))) return false;
  if (u.context_events != null && (!Array.isArray(u.context_events) || u.context_events.length > 64 || u.context_events.some(e => !e || typeof e.id !== 'string' || !e.id || e.id.length > 200 || e.kind !== 'compaction' || !['running','complete'].includes(e.status) || [e.started_at,e.ended_at].some(t => t != null && !Number.isFinite(Date.parse(t)))))) return false;
  const counts = [u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens, u.reasoning_tokens, u.context_tokens, u.context_window_tokens];
  if (counts.some((n) => n != null && (!Number.isSafeInteger(n) || n < 0))) return false;
  if (u.input_tokens != null && (u.cache_read_tokens ?? 0) + (u.cache_write_tokens ?? 0) > u.input_tokens) return false;
  if (u.output_tokens != null && u.reasoning_tokens != null && u.reasoning_tokens > u.output_tokens) return false;
  return !u.complete || (u.input_tokens != null && u.output_tokens != null);
}

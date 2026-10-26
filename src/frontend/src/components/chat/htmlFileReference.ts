import type { Message } from '@/types/message';
import { isHtmlPreviewFile } from './filePreview';

export interface HtmlFileTarget {
  agentId: string;
  workDir: string;
  path: string;
}

/** 只识别文件引用，不把网页 URL、应用附件接口或其它协议改成 daemon 文件读取。 */
export function htmlFilePath(value: string): string | undefined {
  let path = value.trim();
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== 'localhost') return;
      path = url.pathname;
    } catch { return; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return;
  try { path = decodeURIComponent(path); } catch { return; }
  path = path.replace(/\\/g, '/');
  if (path.startsWith('//') || /[\x00-\x1f?#]/.test(path)
    || /^\/(?:api|assets|avatars|downloads)\//.test(path) || !isHtmlPreviewFile(path)) return;
  if (path.split('/').includes('..') || /^\.html?$/i.test(path.slice(path.lastIndexOf('/') + 1))) return;
  return path.replace(/\/\.\//g, '/').replace(/^\.\//, '');
}

function absolute(path: string): boolean {
  return path.startsWith('/') || /^[a-z]:\//i.test(path);
}

function agentId(message: Message): string | undefined {
  if (message.role !== 'assistant') return;
  try {
    const meta: unknown = JSON.parse(message.artifacts_json || '{}');
    if (meta && typeof meta === 'object' && 'agent_id' in meta && typeof meta.agent_id === 'string') return meta.agent_id;
  } catch { /* 历史元信息损坏时不能猜 Agent。 */ }
}

function fileCards(message: Message): { workDir: string; files?: string[] }[] {
  const cards: unknown[] = [];
  for (const raw of [message.cards_json, message.blocks_json]) {
    try {
      const parsed: unknown = JSON.parse(raw || '[]');
      if (Array.isArray(parsed)) cards.push(...parsed);
    } catch { /* 继续尝试结构化数据。 */ }
  }
  cards.push(...(message.cards || []), ...(message.blocks || []));
  return cards.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const c = 'kind' in entry && entry.kind === 'card' && 'card' in entry ? entry.card : entry;
    if (!c || typeof c !== 'object' || !('type' in c) || !('workDir' in c) || typeof c.workDir !== 'string') return [];
    if (c.type !== 'diff' && c.type !== 'project') return [];
    const workDir = c.workDir.replace(/\\/g, '/').replace(/\/$/, '');
    if (!absolute(workDir) || workDir.split('/').includes('..')) return [];
    const files = c.type === 'diff' && 'files' in c && Array.isArray(c.files)
      ? c.files.filter((f): f is string => typeof f === 'string') : undefined;
    return [{ workDir, files }];
  });
}

export function resolveHtmlFileTarget(reference: string, current: Message, history: readonly Message[] = []): HtmlFileTarget | undefined {
  const path = htmlFilePath(reference);
  if (!path || current.role !== 'assistant') return;
  // 汇总消息只能复用同会话精确文件记录；不同机器同路径歧义时不选择任意一个。
  const matches = new Map<string, HtmlFileTarget>();
  for (const message of [current, ...history.filter(m => m.id !== current.id && m.conversation_id === current.conversation_id)]) {
    const id = agentId(message);
    if (!id) continue;
    for (const card of fileCards(message)) {
      for (const file of card.files || []) {
        const normalized = htmlFilePath(file);
        if (!normalized) continue;
        const full = absolute(normalized) ? normalized : `${card.workDir}/${normalized}`;
        if (!full.startsWith(`${card.workDir}/`)) continue;
        if (full === path || (message.id === current.id && !absolute(path) && normalized === path)) {
          matches.set(`${id}:${full}`, { agentId: id, workDir: card.workDir, path: full });
        }
      }
    }
  }
  if (matches.size > 0) return matches.size === 1 ? [...matches.values()][0] : undefined;
  const id = agentId(current);
  if (!id) return;
  if (absolute(path)) return { agentId: id, workDir: path.slice(0, path.lastIndexOf('/')) || '/', path };
  // A diff only proves its explicitly listed files; comparison prose may name
  // an unrelated file from another workspace. Projects declare a workspace.
  const dirs = [...new Set(fileCards(current).filter(card => !card.files).map(card => card.workDir))];
  return dirs.length === 1 ? { agentId: id, workDir: dirs[0]!, path: `${dirs[0]}/${path}` } : undefined;
}

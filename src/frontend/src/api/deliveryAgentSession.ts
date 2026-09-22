import { getAgents } from './agent';
import { getOrCreateAgentChat } from './conversation';
import type { Agent } from '@/types/agent';
import type { Conversation } from '@/types/conversation';

export interface DeliveryAgentSession { agent: Agent; conversation: Conversation }

const pendingSessions = new Map<string, { identity: string; promise: Promise<DeliveryAgentSession> }>();
/** 投放面板与报表面板共用同一套会话生命周期；这里永远选择已存在的本地 Agent，不创建新的“投放agent”。 */
export function ensureDeliveryAgentSession(userId: string, identity: string, isCurrent: () => boolean): Promise<DeliveryAgentSession> {
  const existing = pendingSessions.get(userId);
  if (existing?.identity === identity) return existing.promise;
  const assertCurrent = () => { if (!isCurrent()) throw new Error('登录状态已变化，请重新打开投放agent'); };
  const promise = (async () => {
    assertCurrent();
    const agents = await getAgents();
    assertCurrent();
    const local = agents.filter((item) => item.machine_id && (!item.user_id || item.user_id === userId) && ['online', 'busy'].includes(item.status));
    const agent = local.find((item) => item.name === '报表agent')
      ?? local[0];
    if (!agent) throw new Error('暂无在线本地 Agent，请先连接 Agent 所在电脑后重试');
    const conversation = await getOrCreateAgentChat(agent.id, 'delivery');
    assertCurrent();
    return { agent: agents.find((item) => item.id === conversation.peer_id) ?? agent, conversation };
  })();
  pendingSessions.set(userId, { identity, promise });
  void promise.finally(() => { if (pendingSessions.get(userId)?.promise === promise) pendingSessions.delete(userId); }).catch(() => {});
  return promise;
}

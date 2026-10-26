import type { Message, MessageDelivery } from '@/types/message';

export const deliveryLabels: Record<MessageDelivery['status'], string> = {
  sending: '引导中', steered: '已引导', queued: '排队中', running: '已发送', unconfirmed: '未确认',
};

function readMetadata(json: string | null | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json ?? '{}');
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export function isMessageDelivery(value: unknown): value is MessageDelivery {
  if (value === null || typeof value !== 'object') return false;
  const delivery = value as Partial<MessageDelivery>;
  return typeof delivery.status === 'string' && Object.prototype.hasOwnProperty.call(deliveryLabels, delivery.status)
    && typeof delivery.agent_id === 'string' && typeof delivery.updated_at === 'number' && Number.isFinite(delivery.updated_at);
}

export function readMessageDelivery(json: string | null | undefined): MessageDelivery | undefined {
  const delivery = readMetadata(json).delivery;
  return isMessageDelivery(delivery) ? delivery : undefined;
}

/** HTTP 快照可能晚于实时回执抵达，仅接纳更新的服务端版本。 */
export function mergeMessageDelivery(message: Message, delivery: MessageDelivery | undefined): Message {
  if (message.role !== 'user' || !delivery) return message;
  const current = readMessageDelivery(message.artifacts_json);
  if (current && current.updated_at >= delivery.updated_at) return message;
  return { ...message, artifacts_json: JSON.stringify({ ...readMetadata(message.artifacts_json), delivery }) };
}

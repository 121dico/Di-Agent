import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types/conversation';
import { getTaskBoardConversations, resolveActiveTaskConversationId } from './taskBoardSelection';

describe('Task Board conversation selection', () => {
  const conversations = [
    { id: 'single-1', type: 'single' },
    { id: 'group-1', type: 'group' },
    { id: 'agent-1', type: 'agent' },
  ] as Conversation[];

  it('keeps the active conversation when it is a group', () => {
    const eligible = getTaskBoardConversations(conversations);
    expect(resolveActiveTaskConversationId(eligible, 'group-1')).toBe('group-1');
  });

  it('keeps an Agent private conversation as the selected task workspace', () => {
    const eligible = getTaskBoardConversations(conversations);
    expect(resolveActiveTaskConversationId(eligible, 'agent-1')).toBe('agent-1');
  });

  it('excludes user DMs and falls back to the first task conversation', () => {
    const eligible = getTaskBoardConversations(conversations);
    expect(eligible.map((conversation) => conversation.id)).toEqual(['group-1', 'agent-1']);
    expect(resolveActiveTaskConversationId(eligible, 'single-1')).toBe('group-1');
  });

  it('returns null when there are no task conversations', () => {
    expect(resolveActiveTaskConversationId([], 'single-1')).toBeNull();
  });
});

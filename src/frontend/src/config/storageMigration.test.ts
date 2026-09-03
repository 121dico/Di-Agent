import { describe, expect, it } from 'vitest';
import { migrateLegacyStorage } from './storageMigration';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('migrateLegacyStorage', () => {
  it('preserves login, conversation, and settings while removing retired keys', () => {
    const storage = new MemoryStorage();
    const legacy = [ // [brand-compat] 固定迁移输入，不向用户展示。
      ['agenthub_token', 'token-1'], // [brand-compat]
      ['agenthub_user', '{"id":"user-1"}'], // [brand-compat]
      ['agenthub_active_conv', 'conversation-1'], // [brand-compat]
      ['agenthub_direct_agent_chats', '{"agent-1":"conversation-1"}'], // [brand-compat]
      ['agenthub_notify_sound', 'false'], // [brand-compat]
      ['agenthub_notify_desktop', 'true'], // [brand-compat]
      ['agenthub:task-inspector-width', '520'], // [brand-compat]
    ] as const;
    legacy.forEach(([key, value]) => storage.setItem(key, value));

    migrateLegacyStorage(storage);

    expect(storage.getItem('di_agent_token')).toBe('token-1');
    expect(storage.getItem('di_agent_user')).toBe('{"id":"user-1"}');
    expect(storage.getItem('di_agent_active_conv')).toBe('conversation-1');
    expect(storage.getItem('di_agent_direct_agent_chats')).toBe('{"agent-1":"conversation-1"}');
    expect(storage.getItem('di_agent_notify_sound')).toBe('false');
    expect(storage.getItem('di_agent_notify_desktop')).toBe('true');
    expect(storage.getItem('di_agent:task-inspector-width')).toBe('520');
    legacy.forEach(([key]) => expect(storage.getItem(key)).toBeNull());
  });

  it('never overwrites a canonical value with retired state', () => {
    const storage = new MemoryStorage();
    storage.setItem('di_agent_token', 'current-token');
    storage.setItem('agenthub_token', 'retired-token'); // [brand-compat]

    migrateLegacyStorage(storage);

    expect(storage.getItem('di_agent_token')).toBe('current-token');
    expect(storage.getItem('agenthub_token')).toBeNull(); // [brand-compat]
  });
});

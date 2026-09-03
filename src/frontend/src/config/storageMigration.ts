const LEGACY_TO_CANONICAL_KEYS = [
  ['agenthub_token', 'di_agent_token'], // [brand-compat] 只读取一次旧登录状态。
  ['agenthub_user', 'di_agent_user'], // [brand-compat]
  ['agenthub_active_conv', 'di_agent_active_conv'], // [brand-compat]
  ['agenthub_direct_agent_chats', 'di_agent_direct_agent_chats'], // [brand-compat]
  ['agenthub_notify_sound', 'di_agent_notify_sound'], // [brand-compat]
  ['agenthub_notify_desktop', 'di_agent_notify_desktop'], // [brand-compat]
  ['agenthub:process-panel-collapsed', 'di_agent:process-panel-collapsed'], // [brand-compat]
  ['agenthub:process-panel-position', 'di_agent:process-panel-position'], // [brand-compat]
  ['agenthub:process-panel-size', 'di_agent:process-panel-size'], // [brand-compat]
  ['agenthub:task-inspector-width', 'di_agent:task-inspector-width'], // [brand-compat]
] as const;

/**
 * 把旧浏览器状态迁移到 canonical key。新值优先，避免旧标签页覆盖用户的新状态。
 */
export function migrateLegacyStorage(storage: Storage): void {
  for (const [legacyKey, canonicalKey] of LEGACY_TO_CANONICAL_KEYS) {
    const legacyValue = storage.getItem(legacyKey);
    if (legacyValue !== null && storage.getItem(canonicalKey) === null) {
      storage.setItem(canonicalKey, legacyValue);
    }
    storage.removeItem(legacyKey);
  }
}

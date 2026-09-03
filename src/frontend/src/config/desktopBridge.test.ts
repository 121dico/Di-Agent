import { describe, expect, it, vi } from 'vitest';
import { resolveDesktopBridge } from './desktopBridge';

function bridge(label: string) {
  return {
    platform: label,
    isDesktop: true,
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    onMaximizeChange: vi.fn(() => () => undefined),
  };
}

describe('resolveDesktopBridge', () => {
  it('uses the canonical bridge when available', () => {
    const canonical = bridge('canonical');
    const retired = bridge('retired');
    const host = {
      diAgentDesktop: canonical,
      agentHubDesktop: retired, // [brand-compat] 模拟旧桌面 preload。
    };

    expect(resolveDesktopBridge(host)).toBe(canonical);
  });

  it('keeps an older desktop shell functional during one-time upgrade', () => {
    const retired = bridge('retired');
    const host = { agentHubDesktop: retired }; // [brand-compat]

    expect(resolveDesktopBridge(host)).toBe(retired);
  });
});

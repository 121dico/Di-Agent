// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHUNK_RECOVERY_KEY,
  handleVitePreloadError,
  isChunkLoadError,
} from './chunkRecovery';

describe('chunk recovery', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('reloads once when a stale dynamic module fails to load', () => {
    const reload = vi.fn();
    const event = new Event('vite:preloadError', { cancelable: true });

    const outcome = handleVitePreloadError(event, {
      storage: window.sessionStorage,
      reload,
      path: '/skills',
      now: 1_000,
    });

    expect(outcome).toBe('reloading');
    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(CHUNK_RECOVERY_KEY)).toContain('/skills');
  });

  it('does not enter a reload loop when recovery already ran recently', () => {
    window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, JSON.stringify({ path: '/skills', attemptedAt: 1_000 }));
    const reload = vi.fn();
    const event = new Event('vite:preloadError', { cancelable: true });

    const outcome = handleVitePreloadError(event, {
      storage: window.sessionStorage,
      reload,
      path: '/skills',
      now: 2_000,
    });

    expect(outcome).toBe('showing-fallback');
    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('allows another automatic recovery after the guard window', () => {
    window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, JSON.stringify({ path: '/skills', attemptedAt: 1_000 }));
    const reload = vi.fn();
    const event = new Event('vite:preloadError', { cancelable: true });

    const outcome = handleVitePreloadError(event, {
      storage: window.sessionStorage,
      reload,
      path: '/skills',
      now: 61_001,
    });

    expect(outcome).toBe('reloading');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('recognizes stale chunk and dynamic import errors', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/SkillsView-old.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('ordinary render failure'))).toBe(false);
  });
});

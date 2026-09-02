import { describe, expect, it } from 'vitest';
import { canAccessWorkspacePath } from './workspaceAccess';

const allPaths = ['/', '/contacts', '/agents', '/tasks', '/reports', '/knowledge', '/skills', '/settings'];

describe('workspace access policy', () => {
  it('keeps unfinished task, knowledge, and skill workspaces out of the normal-user product', () => {
    expect(allPaths.filter((path) => canAccessWorkspacePath(path, false))).toEqual(['/', '/contacts', '/agents', '/reports', '/settings']);
    expect(canAccessWorkspacePath('/tasks', false)).toBe(false);
    expect(canAccessWorkspacePath('/knowledge/files', false)).toBe(false);
    expect(canAccessWorkspacePath('/skills', false)).toBe(false);
  });

  it('keeps every workspace available to administrators during debugging', () => {
    expect(allPaths.filter((path) => canAccessWorkspacePath(path, true))).toEqual(allPaths);
    expect(canAccessWorkspacePath('/tasks', true)).toBe(true);
    expect(canAccessWorkspacePath('/knowledge', true)).toBe(true);
    expect(canAccessWorkspacePath('/skills/catalog', true)).toBe(true);
  });
});

const ADMIN_ONLY_WORKSPACE_ROOTS = ['/tasks', '/knowledge', '/skills'] as const;

export function canAccessWorkspacePath(pathname: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return !ADMIN_ONLY_WORKSPACE_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

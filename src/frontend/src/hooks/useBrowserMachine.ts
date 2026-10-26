import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/authStore';
import { BROWSER_IDENTITY_MAX_AGE, invalidateBrowserMachine, recognizeBrowserMachine, resetBrowserMachineStore, useBrowserMachineStore } from '@/store/browserMachineStore';
import type { DaemonMachine } from '@/types/agent';

/** 分类只供展示；不改变选择目标，不替代服务端权限检查。 */
export function useBrowserMachine(machines: DaemonMachine[], loaded = true, enabled = true) {
  const userId = useAuthStore((state) => state.user?.id) ?? '';
  const identity = useBrowserMachineStore();
  const ownedIds = machines.filter((machine) => machine.user_id === userId && machine.status === 'connected').map((machine) => machine.id).sort().join('\n');
  const validScope = identity.userId === userId && Boolean(userId);
  // 新页面初始空列表不是机器已被删除；仅观察到列表后才解释空列表。
  const observedScope = useRef('');
  const verified = validScope && identity.status === 'verified' && Date.now() - identity.verifiedAt < BROWSER_IDENTITY_MAX_AGE && ownedIds.split('\n').includes(identity.machineId);
  useEffect(() => {
    if (!enabled || !validScope || identity.status !== 'verified') return;
    const timer = window.setTimeout(invalidateBrowserMachine, Math.max(0, identity.verifiedAt + BROWSER_IDENTITY_MAX_AGE - Date.now()));
    return () => window.clearTimeout(timer);
  }, [enabled, validScope, identity.status, identity.verifiedAt]);
  useEffect(() => {
    if (!enabled) return;
    if (useBrowserMachineStore.getState().userId !== userId) resetBrowserMachineStore(userId);
    if (userId && useBrowserMachineStore.getState().status === 'idle') void recognizeBrowserMachine(userId, false);
  }, [userId, enabled, identity.status]);
  useEffect(() => {
    if (!enabled || !loaded || !validScope || identity.status !== 'verified') return;
    if (machines.length > 0) observedScope.current = userId;
    if (observedScope.current === userId && !ownedIds.split('\n').includes(identity.machineId)) invalidateBrowserMachine();
  }, [enabled, loaded, validScope, identity.status, identity.machineId, ownedIds, machines.length, userId]);
  const checking = validScope && identity.status === 'checking';
  return {
    checking,
    verified,
    error: validScope ? identity.error : '',
    recognize: () => { void recognizeBrowserMachine(userId, true); },
    label: (machine: Pick<DaemonMachine, 'id' | 'user_id'>) => machine.user_id !== userId ? '待识别' : verified ? machine.id === identity.machineId ? '本机' : '外部' : checking ? '识别中' : '待识别',
  };
}

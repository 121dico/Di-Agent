import { create } from 'zustand';
import { identifyBrowserMachine } from '@/api/browserMachine';

type RecognitionStatus = 'idle' | 'gesture' | 'checking' | 'verified' | 'unavailable';
interface BrowserMachineState {
  verifiedAt: number;
  userId: string;
  machineId: string;
  status: RecognitionStatus;
  error: string;
}
const empty: BrowserMachineState = { verifiedAt: 0, userId: '', machineId: '', status: 'idle', error: '' };
export const BROWSER_IDENTITY_MAX_AGE = 30 * 60 * 1000;
export const useBrowserMachineStore = create<BrowserMachineState>(() => ({ ...empty }));
let epoch = 0;
let controller: AbortController | null = null;

export function resetBrowserMachineStore(userId = '') {
  epoch++; controller?.abort(); controller = null;
  useBrowserMachineStore.setState({ ...empty, userId });
}
export function invalidateBrowserMachine() {
  epoch++; controller?.abort(); controller = null;
  useBrowserMachineStore.setState({ verifiedAt: 0, machineId: '', status: 'unavailable', error: '本机连接已变化或识别已过期，请重新识别。' });
}
export async function recognizeBrowserMachine(userId: string, interactive: boolean) {
  if (!userId) return;
  const current = useBrowserMachineStore.getState();
  if (current.userId !== userId) resetBrowserMachineStore(userId);
  if (useBrowserMachineStore.getState().status === 'checking') return;
  if (!window.isSecureContext && !interactive) {
    useBrowserMachineStore.setState({ status: 'gesture' }); return;
  }
  const version = ++epoch;
  controller?.abort(); controller = new AbortController();
  useBrowserMachineStore.setState({ status: 'checking', machineId: '', error: '' });
  try {
    const machineId = await identifyBrowserMachine(interactive ? 'popup' : 'direct', controller.signal);
    if (version !== epoch) return;
    // 识别只在当前登录页面会话中缓存，不作为操作授权，也不持久化到浏览器存储。
    useBrowserMachineStore.setState({ machineId, status: 'verified', verifiedAt: Date.now() });
  } catch (error) {
    if (version === epoch) useBrowserMachineStore.setState({ status: 'unavailable', error: error instanceof Error ? error.message : '本机识别失败，请重试。' });
  }
}

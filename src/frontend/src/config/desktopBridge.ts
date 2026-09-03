export interface DiAgentDesktopBridge {
  platform: string;
  isDesktop: boolean;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
}

interface DesktopBridgeHost {
  diAgentDesktop?: DiAgentDesktopBridge;
  agentHubDesktop?: DiAgentDesktopBridge; // [brand-compat] 旧 preload 只读入口。
}

export function resolveDesktopBridge(host: DesktopBridgeHost): DiAgentDesktopBridge | undefined {
  return host.diAgentDesktop ?? host.agentHubDesktop; // [brand-compat]
}

declare global {
  interface Window extends DesktopBridgeHost {}
}

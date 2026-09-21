import { useCallback, useEffect, useRef, useState } from 'react';
import { getAgentModels, type RuntimeModelCatalog } from '@/api/agentModels';

interface ModelState {
  identity?: string;
  catalog?: RuntimeModelCatalog;
  loading: boolean;
  error?: string;
}
export function useAgentModels(agentId?: string) {
  const [state, setState] = useState<ModelState>({ loading: false });
  const epoch = useRef(0);
  const active = useRef(agentId);
  const pending = useRef<string>();
  active.current = agentId;
  useEffect(() => () => { epoch.current += 1; pending.current = undefined; }, [agentId]);
  const scan = useCallback(async () => {
    if (!agentId || pending.current === agentId) return;
    const request = ++epoch.current;
    pending.current = agentId;
    setState(old => ({ identity: agentId, catalog: old.identity === agentId ? old.catalog : undefined, loading: true }));
    try {
      const catalog = await getAgentModels(agentId);
      if (request === epoch.current && active.current === agentId) setState({ identity: agentId, catalog, loading: false });
    } catch (error) {
      if (request === epoch.current && active.current === agentId) setState(old => ({ ...old, loading: false, error: error instanceof Error ? error.message : '扫描失败，请重新扫描' }));
    } finally {
      if (request === epoch.current) pending.current = undefined;
    }
  }, [agentId]);
  return { ...(state.identity === agentId ? state : { loading: false }), scan };
}

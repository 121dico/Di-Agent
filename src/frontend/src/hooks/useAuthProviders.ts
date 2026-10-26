import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuthProviders } from '@/api/auth';
import type { AuthProviders } from '@/types/auth';

export function useAuthProviders() {
  const [providers, setProviders] = useState<AuthProviders | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const reload = useCallback(async () => {
    const request = ++epoch.current;
    setLoading(true);
    setError('');
    try {
      const result = await getAuthProviders();
      if (request === epoch.current) setProviders(result);
    } catch (reason) {
      if (request === epoch.current) {
        setProviders(null);
        setError(reason instanceof Error ? reason.message : '登录配置暂不可用，请重试');
      }
    } finally {
      if (request === epoch.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); return () => { epoch.current++; }; }, [reload]);
  return { providers, loading, error, reload, localEnabled: providers?.local_login_enabled ?? true };
}

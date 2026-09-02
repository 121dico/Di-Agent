import { useRouteError } from 'react-router-dom';
import { clearChunkRecoveryGuard, isChunkLoadError } from '@/utils/chunkRecovery';
import './AppErrorFallback.css';

type AppErrorFallbackProps = {
  error?: unknown;
};

export function AppErrorFallback({ error }: AppErrorFallbackProps) {
  const isVersionMismatch = isChunkLoadError(error);

  const reload = () => {
    clearChunkRecoveryGuard();
    window.location.reload();
  };

  const goHome = () => {
    clearChunkRecoveryGuard();
    window.location.assign('/');
  };

  return (
    <main className="app-error" role="alert" aria-live="assertive">
      <section className="app-error__panel">
        <div className="app-error__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M20 11a8 8 0 1 0-2.34 5.66M20 5v6h-6" />
          </svg>
        </div>
        <p className="app-error__eyebrow">DI AGENT · RECOVERY</p>
        <h1>{isVersionMismatch ? '页面版本已更新' : '页面暂时无法显示'}</h1>
        <p className="app-error__description">
          {isVersionMismatch
            ? '刚刚完成了版本切换，当前页面仍在使用旧资源。重新加载后即可继续使用。'
            : '应用遇到了临时问题。你可以重新加载当前页面，或先返回首页继续使用其他功能。'}
        </p>
        <div className="app-error__actions">
          <button type="button" className="app-error__button app-error__button--primary" onClick={reload}>
            重新加载
          </button>
          <button type="button" className="app-error__button" onClick={goHome}>
            返回首页
          </button>
        </div>
        <p className="app-error__hint">
          {isVersionMismatch ? '恢复代码 · MODULE_VERSION_MISMATCH' : '如问题持续出现，请记录当前时间后联系管理员'}
        </p>
      </section>
    </main>
  );
}

export function RouteErrorFallback() {
  return <AppErrorFallback error={useRouteError()} />;
}

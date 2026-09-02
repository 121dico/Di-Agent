import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import theme from './theme/antd';
import { bindMessage } from './utils/message';
import { bindModal } from './utils/modal';
import { installChunkRecovery } from './utils/chunkRecovery';
import { AppErrorFallback } from './components/shell/AppErrorFallback';
import { installDisplayScale } from './utils/displayScale';
import './styles/globals.css';
import './styles/workbench-tokens.css';

// 桌面端标记：尽早设置，让 CSS 能据此隐藏 html/body/#root 的实色背景，
// 使 transparent 窗口 + CSS border-radius 正确裁切圆角
if (window.agentHubDesktop?.isDesktop) {
  document.documentElement.classList.add('ah-desktop');
}

installDisplayScale();

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown | null }
> {
  state = { error: null as unknown | null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <AppErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

installChunkRecovery();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element not found');
}

function MessageBridge({ children }: { children: React.ReactNode }) {
  const { message, modal } = AntdApp.useApp();

  React.useEffect(() => {
    bindMessage(message);
    bindModal(modal);
    return () => {
      bindMessage(null);
      bindModal(null);
    };
  }, [message, modal]);

  return <>{children}</>;
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ConfigProvider theme={theme} locale={zhCN}>
      <AntdApp>
        <MessageBridge>
          <ErrorBoundary><App /></ErrorBoundary>
        </MessageBridge>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);

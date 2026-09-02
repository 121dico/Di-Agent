import React, { useEffect, useState } from 'react';
import styles from './TitleBar.module.css';

declare global {
  interface Window {
    agentHubDesktop?: {
      platform: string;
      isDesktop: boolean;
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      onMaximizeChange: (cb: (maximized: boolean) => void) => () => void;
    };
  }
}

const TitleBar: React.FC = () => {
  const desktop = window.agentHubDesktop;
  // 仅桌面端显示自定义标题栏
  if (!desktop?.isDesktop) return null;

  return <TitleBarInner />;
};

const TitleBarInner: React.FC = () => {
  const desktop = window.agentHubDesktop!;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const cleanup = desktop.onMaximizeChange((maximized) => {
      setIsMaximized(maximized);
    });
    return cleanup;
  }, [desktop]);

  // 最大化状态同步到 body，让布局层据此切换圆角
  useEffect(() => {
    document.body.classList.toggle('ah-maximized', isMaximized);
  }, [isMaximized]);

  return (
    <div className={styles.titleBar}>
      <div className={styles.controls}>
        <button
          className={`${styles.trafficButton} ${styles.closeButton}`}
          onClick={desktop.close}
          aria-label="关闭"
        />
        <button
          className={`${styles.trafficButton} ${styles.minimizeButton}`}
          onClick={desktop.minimize}
          aria-label="最小化"
        />
        <button
          className={`${styles.trafficButton} ${styles.maximizeButton}`}
          onClick={desktop.maximize}
          aria-label={isMaximized ? '还原' : '最大化'}
        />
      </div>

      {/* 拖拽区域：占满整行，双击可切换最大化 */}
      <div
        className={styles.dragRegion}
        onDoubleClick={desktop.maximize}
      >
        <span className={styles.titleText}>Di Agent</span>
      </div>
    </div>
  );
};

export default TitleBar;

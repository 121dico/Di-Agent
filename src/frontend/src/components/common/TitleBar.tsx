import React, { useEffect, useState } from 'react';
import { resolveDesktopBridge } from '@/config/desktopBridge';
import styles from './TitleBar.module.css';

const TitleBar: React.FC = () => {
  const desktop = resolveDesktopBridge(window);
  // 仅桌面端显示自定义标题栏
  if (!desktop?.isDesktop) return null;

  return <TitleBarInner />;
};

const TitleBarInner: React.FC = () => {
  const desktop = resolveDesktopBridge(window)!;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const cleanup = desktop.onMaximizeChange((maximized) => {
      setIsMaximized(maximized);
    });
    return cleanup;
  }, [desktop]);

  // 最大化状态同步到 body，让布局层据此切换圆角
  useEffect(() => {
    document.body.classList.toggle('di-agent-maximized', isMaximized);
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

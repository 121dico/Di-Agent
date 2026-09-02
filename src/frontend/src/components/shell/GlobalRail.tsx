import React, { useState } from 'react';
import { Avatar, Tooltip } from 'antd';
import {
  BarChart3,
  Bot,
  Code2,
  Database,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Users,
  UserRound,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { resolveUserAvatar } from '@/components/agent/agentPresentation';
import { canAccessWorkspacePath } from '@/utils/workspaceAccess';
import styles from './GlobalRail.module.css';

type WsStatus = 'connected' | 'connecting' | 'disconnected';

interface GlobalRailProps {
  username: string;
  wsStatus: WsStatus;
  unreadCount: number;
  onCreate: () => void;
  onOpenCommand: () => void;
  onLogout: () => void;
}

const navItems = [
  { key: 'chat', label: '消息', path: '/', icon: <MessageSquare /> },
  { key: 'contacts', label: '联系人', path: '/contacts', icon: <Users /> },
  { key: 'agents', label: '智能体', path: '/agents', icon: <Bot /> },
  { key: 'tasks', label: '任务', path: '/tasks', icon: <LayoutGrid /> },
  { key: 'reports', label: '报表', path: '/reports', icon: <BarChart3 /> },
  { key: 'knowledge', label: '知识', path: '/knowledge', icon: <Database /> },
  { key: 'skills', label: '技能', path: '/skills', icon: <Code2 /> },
] as const;

const statusLabel: Record<WsStatus, string> = {
  connected: '已连接',
  connecting: '连接中',
  disconnected: '已断开',
};

function isRouteActive(pathname: string, path: string): boolean {
  return path === '/' ? pathname === '/' : pathname.startsWith(path);
}

export const GlobalRail: React.FC<GlobalRailProps> = ({
  username,
  wsStatus,
  unreadCount,
  onCreate,
  onOpenCommand,
  onLogout,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const avatar = user ? resolveUserAvatar(user) : undefined;
  const visibleNavItems = navItems.filter((item) => canAccessWorkspacePath(item.path, user?.is_admin ?? false));
  const [showRailTooltips, setShowRailTooltips] = useState(true);

  return (
    <aside
      className={styles.rail}
      aria-label="全局导航"
      onMouseEnter={() => setShowRailTooltips(false)}
      onMouseLeave={() => setShowRailTooltips(true)}
      onFocusCapture={() => setShowRailTooltips(false)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setShowRailTooltips(true);
        }
      }}
    >
      <div className={styles.railSurface}>
        <div className={styles.brandRow}>
          <span className={styles.brandMark} aria-hidden="true">D</span>
          <span className={styles.brandLabel}>Di Agent</span>
        </div>

        <div className={styles.primaryActions}>
          <Tooltip title={showRailTooltips ? '新建对话 · ⌘N' : undefined} placement="right" mouseEnterDelay={0.5}>
            <button className={styles.createButton} type="button" onClick={onCreate}>
              <Plus />
              <span>新建对话</span>
            </button>
          </Tooltip>
          <Tooltip title={showRailTooltips ? '搜索与命令 · ⌘K' : undefined} placement="right" mouseEnterDelay={0.5}>
            <button className={styles.commandButton} type="button" onClick={onOpenCommand}>
              <Search />
              <span>搜索与命令</span>
              <kbd>⌘K</kbd>
            </button>
          </Tooltip>
        </div>

        <nav className={styles.nav} aria-label="工作区">
          {visibleNavItems.map((item) => {
            const active = isRouteActive(location.pathname, item.path);
            return (
              <Tooltip key={item.key} title={showRailTooltips ? item.label : undefined} placement="right" mouseEnterDelay={0.5}>
                <button
                  className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigate(item.path)}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  <span className={styles.navLabel}>{item.label}</span>
                  {item.key === 'chat' && unreadCount > 0 && (
                    <span className={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
                  )}
                </button>
              </Tooltip>
            );
          })}
        </nav>

        <div className={styles.footer}>
          <Tooltip title={showRailTooltips ? '设置' : undefined} placement="right" mouseEnterDelay={0.5}>
            <button className={styles.navItem} type="button" onClick={() => navigate('/settings')}>
              <span className={styles.navIcon}><Settings /></span>
              <span className={styles.navLabel}>设置</span>
            </button>
          </Tooltip>
          <div className={styles.accountRow}>
            <button className={styles.accountButton} type="button" onClick={() => navigate('/settings')}>
              <Avatar size={28} src={avatar} icon={<UserRound size={14} />} />
              <span className={styles.accountMeta}>
                <strong>{username || '个人账户'}</strong>
                <small><i className={`${styles.statusDot} ${styles[wsStatus]}`} />{statusLabel[wsStatus]}</small>
              </span>
            </button>
            <button className={styles.logoutButton} type="button" onClick={onLogout} aria-label="退出登录">
              <LogOut />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

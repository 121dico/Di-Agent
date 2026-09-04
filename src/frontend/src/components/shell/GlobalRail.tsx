import React, { useEffect, useRef, useState } from 'react';
import { Avatar, Tooltip } from 'antd';
import {
  BarChart3,
  Bot,
  Code2,
  Database,
  LayoutGrid,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
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

const RAIL_COLLAPSED_STORAGE_KEY = 'di_agent_global_rail_collapsed';
const RAIL_TRANSITION_FALLBACK_MS = 260;

function readRailCollapsed(): boolean {
  try {
    return typeof window !== 'undefined'
      && window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function isRouteActive(pathname: string, path: string): boolean {
  return path === '/' ? pathname === '/' : pathname.startsWith(path);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed);
  const [railTransitioning, setRailTransitioning] = useState(false);
  const transitionFallback = useRef<number | null>(null);
  const toggleAtBrand = railCollapsed || railTransitioning;

  useEffect(() => () => {
    if (transitionFallback.current !== null) {
      window.clearTimeout(transitionFallback.current);
    }
  }, []);

  const applyRailCollapsed = (nextCollapsed: boolean) => {
    setRailCollapsed(nextCollapsed);
    try {
      window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, nextCollapsed ? '1' : '0');
    } catch {
      // 本地存储不可用时，当前会话内的收放仍然可用。
    }
  };

  const finishRailTransition = () => {
    if (transitionFallback.current !== null) {
      window.clearTimeout(transitionFallback.current);
      transitionFallback.current = null;
    }
    setRailTransitioning(false);
  };

  const toggleRail = () => {
    if (railTransitioning) return;
    const nextCollapsed = !railCollapsed;
    applyRailCollapsed(nextCollapsed);
    if (prefersReducedMotion()) return;

    setRailTransitioning(true);
    transitionFallback.current = window.setTimeout(() => {
      transitionFallback.current = null;
      setRailTransitioning(false);
    }, RAIL_TRANSITION_FALLBACK_MS);
  };

  const handleRailTransitionEnd = (event: React.TransitionEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'width' || !railTransitioning) return;
    finishRailTransition();
  };

  return (
    <aside
      className={`${styles.rail} ${railCollapsed ? styles.railCollapsed : ''}`}
      aria-label="全局导航"
      data-collapsed={railCollapsed}
      data-transitioning={railTransitioning}
      onTransitionEnd={handleRailTransitionEnd}
    >
      <div className={styles.railSurface}>
        <div className={styles.brandRow}>
          <span className={styles.brandMark} aria-hidden="true">D</span>
          <span className={styles.brandLabel} aria-hidden={railCollapsed}>Di Agent</span>
          <Tooltip
            title={railCollapsed ? '展开侧边栏' : '收起侧边栏'}
            placement={railCollapsed ? 'right' : 'bottom'}
            mouseEnterDelay={0.5}
          >
            <button
              className={toggleAtBrand ? styles.collapsedBrandToggle : styles.railToggle}
              type="button"
              aria-label={railCollapsed ? '展开侧边栏' : '收起侧边栏'}
              aria-expanded={!railCollapsed}
              aria-disabled={railTransitioning}
              onClick={toggleRail}
            >
              <span className={styles.brandToggleIcon} aria-hidden="true">
                {railCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </span>
            </button>
          </Tooltip>
        </div>

        <div className={styles.primaryActions}>
          <Tooltip title={railCollapsed ? '新建对话 · ⌘N' : undefined} placement="right" mouseEnterDelay={0.5}>
            <button
              className={styles.createButton}
              type="button"
              aria-label={railCollapsed ? '新建对话' : undefined}
              onClick={onCreate}
            >
              <Plus />
              <span aria-hidden={railCollapsed}>新建对话</span>
            </button>
          </Tooltip>
          <Tooltip title={railCollapsed ? '搜索与命令 · ⌘K' : undefined} placement="right" mouseEnterDelay={0.5}>
            <button
              className={styles.commandButton}
              type="button"
              aria-label={railCollapsed ? '搜索与命令' : undefined}
              onClick={onOpenCommand}
            >
              <Search />
              <span aria-hidden={railCollapsed}>搜索与命令</span>
              <kbd aria-hidden={railCollapsed}>⌘K</kbd>
            </button>
          </Tooltip>
        </div>

        <nav className={styles.nav} aria-label="工作区">
          {visibleNavItems.map((item) => {
            const active = isRouteActive(location.pathname, item.path);
            const itemLabel = item.key === 'chat' && unreadCount > 0
              ? `${item.label}，${unreadCount > 99 ? '99+' : unreadCount} 条未读`
              : item.label;
            return (
              <Tooltip key={item.key} title={railCollapsed ? item.label : undefined} placement="right" mouseEnterDelay={0.5}>
                <button
                  className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
                  type="button"
                  aria-label={railCollapsed ? itemLabel : undefined}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigate(item.path)}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  <span className={styles.navLabel} aria-hidden={railCollapsed}>{item.label}</span>
                  {item.key === 'chat' && unreadCount > 0 && (
                    <span className={styles.badge} aria-hidden={railCollapsed}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
              </Tooltip>
            );
          })}
        </nav>

        <div className={styles.footer}>
          <Tooltip title={railCollapsed ? '设置' : undefined} placement="right" mouseEnterDelay={0.5}>
            <button
              className={styles.navItem}
              type="button"
              aria-label={railCollapsed ? '设置' : undefined}
              onClick={() => navigate('/settings')}
            >
              <span className={styles.navIcon}><Settings /></span>
              <span className={styles.navLabel} aria-hidden={railCollapsed}>设置</span>
            </button>
          </Tooltip>
          <div className={styles.accountRow}>
            <Tooltip
              title={railCollapsed ? `账户设置 · ${statusLabel[wsStatus]}` : undefined}
              placement="right"
              mouseEnterDelay={0.5}
            >
              <button
                className={styles.accountButton}
                type="button"
                aria-label={railCollapsed ? `账户设置，${statusLabel[wsStatus]}` : undefined}
                onClick={() => navigate('/settings')}
              >
                <span className={styles.avatarWrap}>
                  <Avatar size={28} src={avatar} icon={<UserRound size={14} />} />
                  <i
                    className={`${styles.compactStatusDot} ${styles[wsStatus]}`}
                    aria-hidden="true"
                  />
                </span>
                <span className={styles.accountMeta} aria-hidden={railCollapsed}>
                  <strong>{username || '个人账户'}</strong>
                  <small><i className={`${styles.statusDot} ${styles[wsStatus]}`} />{statusLabel[wsStatus]}</small>
                </span>
              </button>
            </Tooltip>
            <Tooltip title="退出登录" placement="right" mouseEnterDelay={0.5}>
              <button className={styles.logoutButton} type="button" onClick={onLogout} aria-label="退出登录">
                <LogOut />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </aside>
  );
};

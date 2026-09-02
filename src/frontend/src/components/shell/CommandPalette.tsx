import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bot,
  Code2,
  Database,
  LayoutGrid,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import styles from './CommandPalette.module.css';
import { canAccessWorkspacePath } from '@/utils/workspaceAccess';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onCreate: () => void;
  onNavigate: (path: string) => void;
  isAdmin: boolean;
}

export function nextPaletteIndex(current: number, key: string, total: number): number {
  if (total <= 0) return -1;
  if (key === 'ArrowDown') return (Math.max(current, -1) + 1) % total;
  if (key === 'ArrowUp') return (current <= 0 ? total : current) - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return total - 1;
  return current;
}

const commands = [
  { label: '消息', hint: '打开消息工作区', path: '/', icon: <MessageSquare /> },
  { label: '联系人', hint: '查看联系人', path: '/contacts', icon: <Users /> },
  { label: '智能体', hint: '管理 Agent 员工', path: '/agents', icon: <Bot /> },
  { label: '任务', hint: '查看任务与进程', path: '/tasks', icon: <LayoutGrid /> },
  { label: '报表', hint: '打开数据报表', path: '/reports', icon: <BarChart3 /> },
  { label: '知识', hint: '管理知识库', path: '/knowledge', icon: <Database /> },
  { label: '技能', hint: '管理技能', path: '/skills', icon: <Code2 /> },
  { label: '设置', hint: '打开系统设置', path: '/settings', icon: <Settings /> },
] as const;

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, onCreate, onNavigate, isAdmin }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const visibleCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const permittedCommands = commands.filter((command) => canAccessWorkspacePath(command.path, isAdmin));
    if (!normalized) return permittedCommands;
    return permittedCommands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(normalized));
  }, [isAdmin, query]);

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [onClose, open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  return (
    <div className={styles.layer} role="presentation">
      <button className={styles.scrim} type="button" aria-label="关闭命令面板" onClick={onClose} />
      <section
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label="搜索与命令"
        onKeyDown={(event) => {
          const commandCount = visibleCommands.length + (query ? 0 : 1);
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            setActiveIndex((index) => nextPaletteIndex(index, event.key, commandCount));
            return;
          }
          if (event.key === 'Enter' && document.activeElement === inputRef.current) {
            event.preventDefault();
            commandRefs.current[activeIndex]?.click();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className={styles.searchRow}>
          <Search />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索页面或执行命令…"
            role="combobox"
            aria-expanded="true"
            aria-controls="global-command-list"
            aria-activedescendant={`global-command-${activeIndex}`}
          />
          <button type="button" onClick={onClose} aria-label="关闭"><X /></button>
        </header>
        <div id="global-command-list" className={styles.commandList} role="listbox" aria-label="可用命令">
          {!query && (
            <button
              id="global-command-0"
              ref={(node) => { commandRefs.current[0] = node; }}
              className={`${styles.command} ${activeIndex === 0 ? styles.commandActive : ''}`}
              type="button"
              role="option"
              aria-selected={activeIndex === 0}
              onMouseMove={() => setActiveIndex(0)}
              onClick={() => { onClose(); onCreate(); }}
            >
              <span className={styles.commandIcon}><Plus /></span>
              <span><strong>新建对话</strong><small>创建单聊、群聊或 Agent 对话</small></span>
              <kbd>⌘N</kbd>
            </button>
          )}
          {visibleCommands.map((command, commandIndex) => {
            const index = commandIndex + (query ? 0 : 1);
            return (
            <button
              id={`global-command-${index}`}
              ref={(node) => { commandRefs.current[index] = node; }}
              className={`${styles.command} ${activeIndex === index ? styles.commandActive : ''}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              key={command.path}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => { onClose(); onNavigate(command.path); }}
            >
              <span className={styles.commandIcon}>{command.icon}</span>
              <span><strong>{command.label}</strong><small>{command.hint}</small></span>
            </button>
            );
          })}
          {visibleCommands.length === 0 && <div className={styles.empty}>没有匹配的页面或命令</div>}
        </div>
      </section>
    </div>
  );
};

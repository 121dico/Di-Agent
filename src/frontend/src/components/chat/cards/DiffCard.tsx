import React, { useEffect, useRef, useState } from 'react';
import {
  DownOutlined,
  FileAddOutlined,
  FileExcelOutlined,
  FileExclamationOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Spin } from 'antd';
import type { CardProps, DiffCard as DiffCardData } from '@/types/card';
import { fileStatus, fileDiff, type DiffContent } from '@/api/files';
import type { ChangeStatus } from '@/api/files';
import { asyncPool } from '@/utils/asyncPool';
import { DiffViewer } from '@/components/chat/DiffViewer';
import { FilesDrawer } from '@/components/chat/FilesDrawer';
import { isHtmlPreviewFile } from '@/components/chat/filePreview';
import styles from './Cards.module.css';

const STATUS_ICON: Record<ChangeStatus, React.ReactNode> = {
  added: <FileAddOutlined className={styles.iconAdded} />,
  modified: <FileExclamationOutlined className={styles.iconModified} />,
  deleted: <FileExcelOutlined className={styles.iconDeleted} />,
};

const STATUS_LABEL: Record<ChangeStatus, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
};

/**
 * 文件变更卡片（card_type=diff）——只读。
 *
 * 数据契约（解耦设计）：agent 只上报 workDir + files（相对路径数组），
 * 不输出 status 或 diff 内容。卡片打开时由前端调 fileStatus 查 git 状态，
 * 同时预取每个文件的 fileDiff（点文件时秒开 DiffViewer，不必再等 RPC）。
 */
export const DiffCard: React.FC<CardProps<DiffCardData>> = ({ card, agentId }) => {
  const [statuses, setStatuses] = useState<{ path: string; status: ChangeStatus }[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // 预取的 diff 缓存：path → 前后内容。ref 不触发重渲染；
  // 用户点击文件时 handleClickFile 会 setSelectedFile 触发渲染，那时从 ref 读最新缓存。
  const diffCacheRef = useRef<Map<string, DiffContent>>(new Map());

  // 历史卡片在进入消息页时也会挂载。只有用户展开卡片才查询文件，
  // 避免旧消息引用已删除的 Agent 时自动发出多次 404 和全局错误提示。
  //
  // Race guard：用 fetchId 标记每次 useEffect 触发的预取批次。当 card.files 快速变化
  // （比如父组件刷新消息导致 card 引用变化）时，旧的 asyncPool 完成回调 fetchId !== current
  // 直接丢弃，避免旧请求覆盖新缓存。
  const fetchIdRef = useRef(0);
  const filePaths = card.files.join('\0');
  useEffect(() => {
    if (!expanded || !agentId || !card.workDir || !filePaths) {
      setLoading(false);
      return;
    }
    const files = filePaths.split('\0');
    const fetchId = ++fetchIdRef.current;
    let cancelled = false;
    setLoading(true);
    setStatusError('');
    diffCacheRef.current.clear();
    fileStatus(agentId, card.workDir, files)
      .then((result) => {
        if (cancelled || fetchId !== fetchIdRef.current) return;
        // agent 报的文件可能 git 查不到 status（非 git 目录/未跟踪），兜底标为 modified
        const statusMap = new Map(result.map((s) => [s.path, s.status]));
        setStatuses(
          files.map((f) => ({ path: f, status: statusMap.get(f) || 'modified' })),
        );
        // 文件状态可访问时才预取 diff；失效的 Agent 不再触发每个文件各一次 404。
        void asyncPool(
          files.filter(f => !isHtmlPreviewFile(f)),
          (f) => fileDiff(agentId, card.workDir, f),
          3,
        ).then((results) => {
          if (cancelled || fetchId !== fetchIdRef.current) return;
          const diffFiles = files.filter(f => !isHtmlPreviewFile(f));
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') diffCacheRef.current.set(diffFiles[i]!, r.value);
          });
        });
      })
      .catch(() => {
        if (!cancelled && fetchId === fetchIdRef.current) {
          // 旧文件卡片仍可阅读；失败只在卡片内提示，不干扰聊天。
          setStatuses(files.map((f) => ({ path: f, status: 'modified' as ChangeStatus })));
          setStatusError('文件状态暂时无法查询；来源 Agent 可能已删除或无权访问。');
        }
      })
      .finally(() => {
        if (!cancelled && fetchId === fetchIdRef.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, card.workDir, filePaths, expanded]);

  const handleClickFile = (relPath: string) => {
    if (!agentId) return;
    setSelectedFile(relPath);
    setViewerOpen(true);
  };

  return (
    <>
      <div className={styles.diffCard}>
        <button
          type="button"
          className={styles.diffHeader}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className={styles.diffHeaderTitle}>
            {expanded ? <DownOutlined /> : <RightOutlined />}
            <span>{card.title || '文件变更'}</span>
          </span>
          <span className={styles.diffCount}>{card.files.length} 个文件</span>
        </button>
        {loading ? (
          <div className={styles.diffLoading}>
            <Spin size="small" /> 查询改动状态...
          </div>
        ) : expanded ? (<>
          {statusError && <div role="status" className={styles.diffLoading}>{statusError}</div>}
          <ul className={styles.diffList}>
            {statuses.map((s, idx) => (
              <li
                key={`${s.path}-${idx}`}
                className={styles.diffItem}
                onClick={() => handleClickFile(s.path)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleClickFile(s.path);
                  }
                }}
                title={isHtmlPreviewFile(s.path) ? '点击预览网页' : '点击查看前后对比'}
              >
                {STATUS_ICON[s.status]}
                <span className={styles.diffPath}>{s.path}</span>
                <span className={`${styles.diffBadge} ${styles[`badge_${s.status}`] || ''}`}>
                  {STATUS_LABEL[s.status]}
                </span>
              </li>
            ))}
          </ul>
        </>) : (
          <button
            type="button"
            className={styles.diffSummary}
            onClick={() => {
              const onlyFile = card.files[0];
              if (card.files.length === 1 && onlyFile && isHtmlPreviewFile(onlyFile)) handleClickFile(onlyFile);
              else setExpanded(true);
            }}
          >
            <span>{statuses[0]?.path || card.files[0] || '查看文件变更'}</span>
            {card.files.length > 1 && <span>另有 {card.files.length - 1} 个文件</span>}
          </button>
        )}
      </div>
      {agentId && selectedFile && isHtmlPreviewFile(selectedFile) ? (
        <FilesDrawer
          key={`${agentId}:${card.workDir}:${selectedFile}`}
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          agentId={agentId}
          workDir={card.workDir}
          initialPath={selectedFile.startsWith('/') || /^[a-z]:[\\/]/i.test(selectedFile)
            ? selectedFile : `${card.workDir.replace(/\/$/, '')}/${selectedFile}`}
        />
      ) : agentId && selectedFile && (
        <DiffViewer
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          agentId={agentId}
          workDir={card.workDir}
          filePath={selectedFile}
          title={card.title}
          initialDiff={diffCacheRef.current.get(selectedFile)}
        />
      )}
    </>
  );
};

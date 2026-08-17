import React, { useMemo, useState } from 'react';
import { Button, Input, Spin, Tooltip } from 'antd';
import {
  DatabaseOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { reindexKnowledgeBase, searchKnowledgeBaseRAG } from '@/api/knowledge';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import type { KnowledgeBase, KnowledgeFile, KnowledgeRAGResult } from '@/types/knowledge';
import { message } from '@/utils/message';
import styles from './KnowledgeRAGPanel.module.css';

interface KnowledgeRAGPanelProps {
  knowledgeBase: KnowledgeBase;
  onFileSelect?: (file: KnowledgeFile, kbId: string) => void;
}

const modeLabels: Record<KnowledgeRAGResult['retrieval_mode'], string> = {
  keyword: '关键词',
  vector: '向量',
  reranked: '重排',
};

const KnowledgeRAGPanel: React.FC<KnowledgeRAGPanelProps> = ({ knowledgeBase, onFileSelect }) => {
  const refreshKnowledgeBases = useKnowledgeStore((s) => s.fetchKnowledgeBases);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeRAGResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const status = useMemo(() => {
    const counts = { indexed: 0, failed: 0, processing: 0, skipped: 0 };
    knowledgeBase.files.forEach((file) => {
      if (file.rag_status === 'indexed') counts.indexed += 1;
      else if (file.rag_status === 'failed') counts.failed += 1;
      else if (file.rag_status === 'skipped') counts.skipped += 1;
      else counts.processing += 1;
    });
    return counts;
  }, [knowledgeBase.files]);

  const runSearch = async () => {
    const value = query.trim();
    if (!value || searching) return;
    setSearching(true);
    try {
      const nextResults = await searchKnowledgeBaseRAG(knowledgeBase.id, value);
      setResults(nextResults);
      setHasSearched(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'RAG 检索失败');
    } finally {
      setSearching(false);
    }
  };

  const runReindex = async () => {
    if (reindexing) return;
    setReindexing(true);
    try {
      const result = await reindexKnowledgeBase(knowledgeBase.id);
      await refreshKnowledgeBases(true);
      message.success(
        `索引完成：成功 ${result.indexed_files}，失败 ${result.failed_files}，跳过 ${result.skipped_files}`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重建索引失败');
    } finally {
      setReindexing(false);
    }
  };

  const openSource = (result: KnowledgeRAGResult) => {
    const file = knowledgeBase.files.find((item) => item.id === result.file_id);
    if (file) onFileSelect?.(file, knowledgeBase.id);
  };

  return (
    <section className={styles.container} aria-label={`${knowledgeBase.name} RAG 检索`}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <DatabaseOutlined className={styles.titleIcon} />
          <div className={styles.titleText}>
            <h2>{knowledgeBase.name}</h2>
            <span>RAG 检索</span>
          </div>
        </div>
        <Button
          icon={<ReloadOutlined spin={reindexing} />}
          loading={reindexing}
          disabled={knowledgeBase.files.length === 0}
          onClick={runReindex}
        >
          重建索引
        </Button>
      </header>

      <div className={styles.statusBar}>
        <span className={styles.statusItem}><i className={styles.indexedDot} />已索引 {status.indexed}</span>
        <span className={styles.statusItem}><i className={styles.processingDot} />待处理 {status.processing}</span>
        <span className={styles.statusItem}><i className={styles.skippedDot} />已跳过 {status.skipped}</span>
        <span className={styles.statusItem}>
          <i className={styles.failedDot} />失败 {status.failed}
          {status.failed > 0 && (
            <Tooltip
              title={knowledgeBase.files
                .filter((file) => file.rag_status === 'failed')
                .map((file) => `${file.filename}: ${file.rag_error || '索引失败'}`)
                .join('\n')}
            >
              <WarningOutlined className={styles.warningIcon} />
            </Tooltip>
          )}
        </span>
      </div>

      <div className={styles.searchRow}>
        <Input
          size="large"
          prefix={<SearchOutlined />}
          placeholder="输入要检索的问题"
          value={query}
          allowClear
          onChange={(event) => setQuery(event.target.value)}
          onPressEnter={runSearch}
        />
        <Button type="primary" size="large" icon={<SearchOutlined />} loading={searching} onClick={runSearch}>
          检索
        </Button>
      </div>

      <div className={styles.results}>
        {searching ? (
          <div className={styles.emptyState}><Spin /></div>
        ) : results.length > 0 ? (
          results.map((result, index) => (
            <article className={styles.resultItem} key={`${result.id}-${index}`}>
              <div className={styles.resultHeader}>
                <div className={styles.sourceName} title={result.filename}>
                  <FileSearchOutlined />
                  <span>{result.filename}</span>
                </div>
                <div className={styles.resultMeta}>
                  <span className={`${styles.mode} ${styles[result.retrieval_mode]}`}>{modeLabels[result.retrieval_mode]}</span>
                  {result.retrieval_mode !== 'keyword' && <span>相关度 {(result.score * 100).toFixed(1)}%</span>}
                  {onFileSelect && (
                    <Tooltip title="查看来源文件">
                      <button className={styles.sourceButton} type="button" onClick={() => openSource(result)}>
                        <FileSearchOutlined />
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
              {result.summary && <p className={styles.summary}>{result.summary}</p>}
              <p className={styles.content}>{result.content}</p>
            </article>
          ))
        ) : (
          <div className={styles.emptyState}>
            <SearchOutlined />
            <span>{hasSearched ? '没有找到相关内容' : '等待检索'}</span>
          </div>
        )}
      </div>
    </section>
  );
};

export default KnowledgeRAGPanel;

import React, { useEffect } from 'react';
import { Button, Spin } from 'antd';
import { AlertCircle, BarChart3, FileBarChart, MessageSquare, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePersonalReportStore } from '@/store/personalReportStore';
import { PersonalReportPreview } from './PersonalReportPreview';
import styles from './PersonalReportsLibrary.module.css';

export const PersonalReportsLibrary: React.FC = () => {
  const navigate = useNavigate();
  const reports = usePersonalReportStore((state) => state.reports);
  const activeReport = usePersonalReportStore((state) => state.activeReport);
  const loading = usePersonalReportStore((state) => state.loading);
  const error = usePersonalReportStore((state) => state.error);
  const loadReports = usePersonalReportStore((state) => state.loadReports);
  const selectReport = usePersonalReportStore((state) => state.selectReport);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!activeReport && reports.length > 0) selectReport(reports[0] ?? null);
  }, [activeReport, reports, selectReport]);

  if (loading && reports.length === 0) {
    return <div className={styles.center}><Spin size="small" /><strong>正在读取我的报表</strong><span>正在同步你保存的真实数据报表</span></div>;
  }

  if (error && reports.length === 0) {
    return (
      <div className={styles.center} role="alert">
        <span className={styles.stateIcon} data-state="error"><AlertCircle size={22} /></span>
        <strong>我的报表加载失败</strong>
        <span>{error}</span>
        <Button icon={<RefreshCw size={14} />} onClick={() => void loadReports()}>重新加载</Button>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className={styles.center}>
        <div className={styles.emptyVisual} aria-hidden="true"><BarChart3 size={26} /><i /><i /><i /></div>
        <strong>还没有个人报表</strong>
        <p>在 Agent 对话中查询真实数据并生成后，报表会自动保存在这里，不会出现推测数字。</p>
        <Button type="primary" icon={<MessageSquare size={14} />} onClick={() => navigate('/')}>去和 Agent 对话</Button>
      </div>
    );
  }

  return (
    <div className={styles.library}>
      {error && (
        <div className={styles.inlineError} role="status">
          <AlertCircle size={14} /><span>{error}</span><button type="button" onClick={() => void loadReports()}>重新同步</button>
        </div>
      )}
      <aside className={styles.list} aria-label="我的报表列表">
        <header><div><strong>我的报表</strong><small>按最近更新排序</small></div><span>{reports.length}</span></header>
        {reports.map((report) => (
          <button
            key={report.id}
            type="button"
            aria-current={activeReport?.id === report.id ? 'page' : undefined}
            onClick={() => selectReport(report)}
          >
            <span className={styles.reportIcon}><FileBarChart size={16} /></span>
            <span className={styles.reportCopy}>
              <strong>{report.title}</strong>
              <small>{report.status === 'saved' ? '已保存' : report.status === 'failed' ? '生成失败' : '草稿'} · 第 {report.revision} 版</small>
            </span>
            <time dateTime={report.updated_at}>{new Date(report.updated_at).toLocaleDateString('zh-CN')}</time>
          </button>
        ))}
      </aside>
      <main className={styles.preview}>
        <PersonalReportPreview report={activeReport} />
      </main>
    </div>
  );
};

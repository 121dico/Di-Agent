import React from 'react';
import { BarChart3, Database, Sparkles } from 'lucide-react';
import type { PersonalReport } from '@/types/personalReport';
import styles from './PersonalReportPreview.module.css';

interface Props {
  report: PersonalReport | null;
}

const statusLabel: Record<PersonalReport['status'], string> = {
  draft: '草稿',
  saved: '已保存',
  failed: '生成失败',
};

const sectionTypeLabel: Record<string, string> = {
  metric: '核心指标',
  metrics: '核心指标',
  chart: '数据图表',
  table: '数据明细',
  insight: 'Agent 洞察',
  text: '分析结论',
};

export const PersonalReportPreview: React.FC<Props> = ({ report }) => {
  if (!report) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyVisual} aria-hidden="true">
          <span><BarChart3 size={24} /></span>
          <i />
          <i />
          <i />
        </div>
        <strong>从真实数据开始一份个人报表</strong>
        <p>在当前对话中告诉 Agent 你想分析的问题；完成真实查询后，指标、图表和依据会显示在这里。</p>
      </div>
    );
  }

  const sections = report.document?.sections ?? [];
  const provenance = report.provenance ?? {};

  return (
    <article className={styles.preview} data-style={report.style_preset} aria-label={`个人报表：${report.title}`}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><Sparkles size={12} /> PERSONAL REPORT</span>
          <h2>{report.title}</h2>
          {report.description && <p>{report.description}</p>}
        </div>
        <div className={styles.reportMeta}>
          <span className={styles.status} data-status={report.status}>{statusLabel[report.status]}</span>
          <span>第 {report.revision} 版</span>
          <time dateTime={report.updated_at}>
            更新于 {new Date(report.updated_at).toLocaleString('zh-CN', { hour12: false })}
          </time>
        </div>
      </header>

      {(provenance.source_name || provenance.source_partition || provenance.query_id) && (
        <section className={styles.provenance} aria-label="真实查询依据">
          <header><Database size={15} /><strong>真实查询依据</strong><span>数据字段按权限展示</span></header>
          <dl>
            {provenance.source_name && <div><dt>数据源</dt><dd>{String(provenance.source_name)}</dd></div>}
            {provenance.source_partition && <div><dt>数据分区</dt><dd>{String(provenance.source_partition)}</dd></div>}
            {provenance.query_id && <div><dt>查询标识</dt><dd>{String(provenance.query_id)}</dd></div>}
          </dl>
        </section>
      )}

      {sections.length > 0 ? (
        <div className={styles.sections}>
          {sections.map((section, index) => (
            <section key={section.id || `${section.type}-${index}`} className={styles.section}>
              <span>{sectionTypeLabel[section.type] ?? section.type}</span>
              <h3>{section.title || `报表区块 ${index + 1}`}</h3>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.documentEmpty}>
          <span><BarChart3 size={20} /></span>
          <strong>这份报表还没有可展示的区块</strong>
          <p>真实查询结果返回后，指标、图表和分析结论会按顺序出现在这里。</p>
        </div>
      )}
    </article>
  );
};

import { useState } from 'react';
import { Empty } from 'antd';
import { Database } from 'lucide-react';
import type { PersonalReport, PersonalReportSection } from '@/types/personalReport';
import type { ReportAnalyticsResult } from '@/types/report';
import { IncrementBarChart, SmoothChart } from '@/components/report/ReportCharts';
import { REPORT_TEMPLATE_ONE_VERSION, TemplateOneBarChart, TemplateOneDonutChart, TemplateOneLineChart } from '@/components/report/ReportTemplateOneCharts';
import { ReportCohortSections } from '@/components/report/ReportCohortSections';
import { ReportLaneTrends } from '@/components/report/ReportLaneTrends';
import reportStyles from '@/views/ReportsView.module.css';
import styles from './PersonalReportPreview.module.css';

function numberValue(value: unknown): number {
  if (value == null || value === '') return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function displayValue(value: unknown, suffix = ''): string {
  if (value == null || value === '') return '—';
  const number = numberValue(value);
  return `${Number.isFinite(number) ? number.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : String(value)}${suffix}`;
}

function TemplateChart({ section }: { section: PersonalReportSection }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const rows = section.data?.rows ?? [];
  if (rows.length === 0) return <Empty description="当前查询没有可用数据" />;
  if (section.chart_type === 'donut') {
    const distribution = rows.map((row) => ({ label: String(row[section.label_field ?? ''] ?? '未知'), value: numberValue(row[section.value_field ?? '']) }))
      .filter((item) => Number.isFinite(item.value) && item.value >= 0);
    return <TemplateOneDonutChart distribution={distribution} hidden={hidden} onToggle={(label) => setHidden((old) => {
      const next = new Set(old);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    })} />;
  }
  const labels = rows.map((row) => String(row[section.x_field ?? ''] ?? '—'));
  const series = (section.series ?? []).map((item) => ({ key: item.field, label: item.label, values: rows.map((row) => numberValue(row[item.field])) }));
  if (section.chart_type === 'bar') return <TemplateOneBarChart labels={labels} values={series[0]?.values ?? []} valueLabel={series[0]?.label ?? section.title ?? ''} />;
  return <TemplateOneLineChart labels={labels} series={series} />;
}

function TemplateSection({ section, index }: { section: PersonalReportSection; index: number }) {
  const rows = section.data?.rows ?? [];
  if (section.type === 'v12_dashboard') {
    const analytics = rows[0]?.analytics as ReportAnalyticsResult | undefined;
    return analytics ? <ReportCohortSections analytics={analytics} loading={false} error=""
      renderChart={(labels, series, mode) => mode === 'trend'
        ? <ReportLaneTrends labels={labels} series={series} />
        : <SmoothChart labels={labels} series={series} scaleMode={mode} height={270} trendRule="raw" pendingText="请开启至少一个图例" />}
      renderGrowthChart={(labels, series) => <SmoothChart labels={labels} series={series} height={270} trendRule="raw" pendingText="暂无连续快照可计算增长" />}
      renderBar={(labels, values) => <IncrementBarChart labels={labels} values={values} raw />} />
      : <Empty description="V1.2 快照尚未就绪" />;
  }
  return <section className={`${reportStyles.summaryBlock} ${reportStyles.fullWidthBlock}`} id={`personal-report-${section.id}`}>
    <div className={reportStyles.blockHead}><div><span>{String(index + 1).padStart(2, '0')}</span><strong>{section.title}</strong></div><small>真实查询 · {section.query_id?.slice(0, 8) ?? '—'}</small></div>
    {section.type === 'metric' || section.type === 'metrics' ? (
      rows.length > 0 ? <div className={reportStyles.metrics}>{(section.metrics ?? []).map((metric) => <article key={metric.field} className={reportStyles.metricCard}>
        <span>{metric.label}</span><strong>{displayValue(rows[0]?.[metric.field], metric.suffix)}</strong>
      </article>)}</div> : <Empty description="当前查询没有可用指标" />
    ) : section.type === 'chart' ? <div className={`${reportStyles.card} ${reportStyles.trendCard}`}>
      <div className={reportStyles.cardTitle}><div><i />{section.title}</div></div><TemplateChart section={section} />
    </div> : section.type === 'table' ? <div className={`${reportStyles.card} ${reportStyles.tableCard}`}>
      {rows.length > 0 ? <div className={reportStyles.tableWrap}><table className={reportStyles.dataTable}>
        <thead><tr>{(section.columns ?? []).map((column) => <th key={column.field}>{column.label}</th>)}</tr></thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={`${section.query_id}-${rowIndex}`}>{(section.columns ?? []).map((column) => <td key={column.field} title={displayValue(row[column.field])}>{displayValue(row[column.field], column.suffix)}</td>)}</tr>)}</tbody>
      </table></div> : <Empty description="当前查询没有可用明细" />}
      <div className={reportStyles.tableFooter}><span>本页 {rows.length} 行 · 查询总量 {section.data?.pagination?.total ?? rows.length} 行</span></div>
    </div> : <Empty description="当前模板不支持此板块" />}
  </section>;
}

export function TemplatePersonalReport({ report }: { report: PersonalReport }) {
  const sections = report.document.sections ?? [];
  const v12Dashboard = sections.length === 1 && sections[0]?.type === 'v12_dashboard';
  const provenance = report.provenance ?? {};
  const layout: Array<Array<{ section: PersonalReportSection; index: number }>> = [];
  sections.forEach((section, index) => {
    const last = layout[layout.length - 1];
    if (section.type === 'chart' && last?.length === 1 && last[0]?.section.type === 'chart') last.push({ section, index });
    else layout.push([{ section, index }]);
  });
  return <article className={`${styles.preview} ${styles.templatePreview}`} aria-label={`个人报表：${report.title}`}>
    <div className={`${reportStyles.dashboard} ${reportStyles.v12Dashboard}`}>
      <section className={reportStyles.summaryHero}><div>
        <span className={reportStyles.eyebrow}>REPORT OVERVIEW · BUSINESS INSIGHT</span><h2>{report.title}</h2>
        <div className={reportStyles.summaryMeta}>
          <span>数据分区 {provenance.source_partition || '—'}</span><span>数据源 {provenance.source_name || '—'}</span>
          <span>更新于 {new Date(report.updated_at).toLocaleString('zh-CN', { hour12: false })}</span>
          <span>模板一 · v{report.document.template_version ?? REPORT_TEMPLATE_ONE_VERSION}</span>
        </div>
      </div></section>
      {report.description && <p className={styles.templateDescription}>{report.description}</p>}
      <nav className={reportStyles.anchorBar} aria-label="个人报表板块导航">{v12Dashboard ? [
        ['report-overview', '全量人群'], ['report-order-cohort', '价敏人群分布'], ['report-increments', '增量分析'], ['report-trend', 'dt 历史趋势'],
      ].map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>) : sections.map((section) => <a key={section.id} href={`#personal-report-${section.id}`}>{section.title}</a>)}</nav>
      {layout.map((group) => group.length === 2 ? <div key={group[0]?.section.id} className={`${reportStyles.chartGrid} ${styles.templateChartGrid}`}>
        {group.map(({ section, index }) => <TemplateSection key={section.id} section={section} index={index} />)}
      </div> : group.map(({ section, index }) => <TemplateSection key={section.id} section={section} index={index} />))}
      <section className={styles.provenance} aria-label="真实查询依据"><header><Database size={15} /><strong>真实查询依据</strong><span>数据字段按权限展示</span></header>
        <dl><div><dt>数据源</dt><dd>{String(provenance.source_name ?? '—')}</dd></div><div><dt>数据分区</dt><dd>{String(provenance.source_partition ?? '—')}</dd></div><div><dt>查询凭证</dt><dd>{String(provenance.query_id ?? '—')}</dd></div></dl>
      </section>
    </div>
  </article>;
}

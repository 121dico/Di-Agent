import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Form, Input, Modal, Select, Spin, Switch } from 'antd';
import {
  ArrowLeftOutlined,
  BarChartOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  EditOutlined,
  EnvironmentOutlined,
  FilterOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { message } from '@/utils/message';
import {
  createReport,
  createReportSource,
  downloadReportRun,
  getReportSourceContract,
  listReportRuns,
  listReports,
  listReportSources,
  queryReportAnalytics,
  queryReportPage,
  queryReportSearch,
  runReport,
  saveReportSourceContract,
  updateReport,
} from '@/api/report';
import { useAuthStore } from '@/store/authStore';
import type { ReportAnalyticsRange, ReportAnalyticsResult, ReportDataSource, ReportDefinition, ReportPageResult, ReportRun, ReportVisualization } from '@/types/report';
import { buildChartDomain, buildDateTickIndexes, buildPriceSensitiveAnalyticsPresentation, buildReportPresentation, filterAndSortReportRows, formatChartDateTick, reportColumnsForGroup } from './reportPresentation';
import type { ReportFieldGroup, ReportSort } from './reportPresentation';
import { buildReportAccessPolicy } from './reportAccess';
import { filterReportSources } from './reportSourceSearch';
import { PersonalReportsLibrary } from '@/components/personal-report/PersonalReportsLibrary';
import { ReportTemplateModal } from '@/components/report/ReportTemplateModal';
import { ReportCohortSections } from '@/components/report/ReportCohortSections';
import { ReportLaneTrends } from '@/components/report/ReportLaneTrends';
import { loadStoredSnapshotHistory } from './reportSnapshotHistory';
import { formatReportAxisTick } from './reportAxisTick';
import { normalizeReportTrend, reportDailyRate, type ReportScaleMode } from './reportTrendScale';
import { detectIncrementOutliers, detectReportOutliers } from './reportOutliers';
import { buildEstimatedCurvePath, buildObservedCurvePath } from './reportCurvePath';
import { ChinaRegionPicker, expandChinaRegionSelection, summarizeChinaRegionSelection } from '@/components/report/ChinaRegionPicker';
import styles from './ReportsView.module.css';

const defaultQuery = JSON.stringify({ fieldList: [{ name: 'duid', alias: 'user_count', aggFunctionEnum: 'COUNT DISTINCT' }], conditionList: [], groupList: [], needPagination: false }, null, 2);
const defaultVisualization = JSON.stringify({ metrics: [{ field: 'user_count', label: '用户数', suffix: '人' }], chart: { xField: 'dt', series: [{ field: 'user_count', label: '用户数', color: '#F2802E' }] } }, null, 2);

interface SourceForm {
  name: string;
  description: string;
  endpoint: string;
  api_name: string;
  app_key_env: string;
  signature_env: string;
  x_date_env?: string;
  api_example: string;
  response_example: string;
  hive_table: string;
  hive_ddl: string;
  hive_example: string;
  enabled: boolean;
}
interface ReportForm { name: string; description?: string; data_source_id: string; query: string; visualization: string; enabled: boolean }

const statusLabel: Record<ReportRun['status'], string> = { pending: '运行中', succeeded: '已完成', failed: '失败' };
const chartColors = ['#2F6FDB', '#15857A', '#765BC4', '#D18A24', '#D05C50'];
const sensitivityColors: Record<string, string> = { 极高价敏: '#A63437', 高价敏: '#D75A50', 中高价敏: '#DB843C', 中价敏: '#D79A2B', 中低价敏: '#259F9A', 低价敏: '#4B78D1', 极低价敏: '#7B9ECA', 未知: '#8B8E95' };
const rangeOptions: Array<{ value: ReportAnalyticsRange; label: string }> = [
  { value: 'all', label: '全部 dt 历史' },
  { value: '1d', label: '近 1 天' },
  { value: '7d', label: '近 7 天' },
  { value: '31d', label: '近 31 天' },
  { value: '365d', label: '近 1 年' },
];
const cityOptions = ['北京市', '上海市', '广州市', '深圳市', '杭州市', '成都市', '武汉市', '南京市', '重庆市', '西安市', '苏州市', '天津市']
  .map((city) => ({ label: city, value: city }));
const fieldGroups: Array<{ value: ReportFieldGroup; label: string }> = [
  { value: 'result', label: '核心结果' },
  { value: 'd1', label: 'D1 价格' },
  { value: 'd2', label: 'D2 优惠' },
  { value: 'd3', label: 'D3 时间' },
  { value: 'd4', label: 'D4 修正' },
  { value: 'all', label: '全部字段' },
];
function formatCell(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function compactCount(value: number): string {
  if (value >= 100_000_000) return `${Number((value / 100_000_000).toFixed(1))}亿`;
  if (value >= 10_000) return `${Number((value / 10_000).toFixed(1))}万`;
  return value.toLocaleString('zh-CN');
}

function formatChartValue(value: number): string {
  if (Math.abs(value) >= 10_000) return compactCount(Math.round(value));
  return Number(value.toFixed(2)).toLocaleString('zh-CN');
}

interface ChartSeries { key?: string; label: string; color?: string; values: number[] }

function useResponsiveChartWidth(): [React.RefObject<HTMLDivElement>, number] {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(920);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateWidth = () => setWidth(Math.max(280, Math.round(container.clientWidth)));
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  return [containerRef, width];
}

interface SmoothChartProps {
  labels: string[];
  series: ChartSeries[];
  pendingText?: string;
  bounds?: [number, number];
  height?: number;
  trendRule?: 'default' | 'nonnegative' | 'nondecreasing' | 'raw';
  scaleMode?: ReportScaleMode;
}

export function SmoothChart({ labels, series, pendingText, bounds, height = 360, scaleMode = 'actual' }: SmoothChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [chartRef, width] = useResponsiveChartWidth();
  const chartHeight = labels.length <= 1 ? Math.min(height, 240) : height;
  const padding = { top: 26, right: 24, bottom: 44, left: 62 };
  const trendModels = useMemo(() => series.map((item) => {
    // 日增量的极端单次变化（包括末日）不能撑大正常趋势的刻度。
    const outlierIndexes = item.key === 'dailyNet' || item.key === 'growthRate'
      ? detectIncrementOutliers(item.values, labels, item.key === 'growthRate' ? 1e-6 : 1)
      : detectReportOutliers(item.values, labels);
    const plotValues = scaleMode === 'trend' ? normalizeReportTrend(item.values, outlierIndexes) : item.values.map(Math.abs);
    const outliers = new Set(outlierIndexes);
    return { ...item, plotValues, trend: { fittedValues: plotValues.map((value, index) => outliers.has(index) ? NaN : value), outlierIndexes } };
  }), [series, labels, scaleMode]);
  const values = series.flatMap((item) => item.values).filter(Number.isFinite);
  const domainValues = trendModels.flatMap((item) => {
    const outliers = new Set(item.trend.outlierIndexes);
    return item.plotValues.filter((value, index) => Number.isFinite(value) && !outliers.has(index));
  });
  const domain = domainValues.length === 0 ? { min: 0, max: 1 } : buildChartDomain(domainValues, scaleMode === 'trend' ? undefined : [Math.max(0, bounds?.[0] ?? 0), bounds?.[1] ?? Infinity]);
  const hasNegative = values.some((value) => value < 0);
  const min = domain.min;
  const max = domain.max;
  const range = max - min || 1;
  const point = (value: number, index: number, count: number) => ({
    x: count === 1 ? width / 2 : padding.left + (index * (width - padding.left - padding.right)) / Math.max(1, count - 1),
    y: chartHeight - padding.bottom - ((value - min) / range) * (chartHeight - padding.top - padding.bottom),
  });
  const hasValues = series.length > 0 && values.length > 0;
  const xFor = (index: number) => labels.length <= 1
    ? width / 2
    : padding.left + (index * (width - padding.left - padding.right)) / Math.max(1, labels.length - 1);
  const yTicks = Array.from({ length: 5 }, (_, index) => max - index * (range / 4));
  const xTicks = buildDateTickIndexes(labels.length, width - padding.left - padding.right);
  const activeX = activeIndex == null ? null : xFor(activeIndex);
  const activeSeries = activeIndex == null
    ? []
    : trendModels.flatMap((item, index) => {
      const value = item.values[activeIndex];
      return typeof value === 'number' && Number.isFinite(value)
        ? [{ ...item, color: item.color ?? chartColors[index % chartColors.length], value, isOutlier: item.trend.outlierIndexes.includes(activeIndex) }]
        : [];
    });
  const tooltipAlign = activeIndex === 0 ? 'start' : activeIndex === labels.length - 1 ? 'end' : 'center';
  const seriesInsights = trendModels.flatMap((item, index) => {
    const finite = item.values.filter(Number.isFinite);
    if (finite.length === 0) return [];
    const first = finite[0]!;
    const latest = finite[finite.length - 1]!;
    const delta = latest - first;
    return [{
      key: item.key ?? item.label,
      label: item.label,
      color: item.color ?? chartColors[index % chartColors.length],
      latest,
      delta,
      spread: Math.max(...finite) - Math.min(...finite),
      count: finite.length,
      outlierCount: item.trend.outlierIndexes.length,
    }];
  });
  return (
    <div ref={chartRef} className={styles.chartWrap} onMouseLeave={() => setActiveIndex(null)}>
      {hasValues && <div className={styles.chartReadout}>
        <div className={styles.chartScaleMeta}><span>{scaleMode === 'trend' ? '独立刻度' : hasNegative ? '幅度（绝对值）' : '真实数值'}</span>{scaleMode !== 'trend' && <b>{formatChartValue(min)}–{formatChartValue(max)}</b>}</div>
        <div className={styles.chartSignals}>{seriesInsights.map((item) => <div key={item.key}>
          <i style={{ background: item.color }} />
          <span>{item.label}</span>
          <strong>{formatChartValue(item.latest)}</strong>
          <em data-direction={item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : 'flat'}>{item.count < 2 ? '单日基准' : `${item.delta > 0 ? '+' : ''}${formatChartValue(item.delta)} · 波动 ${formatChartValue(item.spread)}${item.outlierCount ? ` · ${item.outlierCount} 个疑似离群点` : ''}`}</em>
        </div>)}</div>
      </div>}
      {trendModels.some((item) => item.trend.outlierIndexes.length > 0) && <div className={styles.singleDayHint}>○ 疑似离群 · 虚线：估计值</div>}
      <svg viewBox={`0 0 ${width} ${chartHeight}`} className={styles.chart} role="img" aria-label="报表趋势图">
        {yTicks.map((tick, index) => {
          const y = padding.top + index * ((chartHeight - padding.top - padding.bottom) / 4);
          return <g key={tick}><line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className={styles.gridLine} />{scaleMode !== 'trend' && <text x={padding.left - 12} y={y + 4} textAnchor="end" className={styles.axisLabel}>{formatReportAxisTick(tick, range / 4)}</text>}</g>;
        })}
        {xTicks.map((index) => <text key={index} x={xFor(index)} y={chartHeight - 13} textAnchor={index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'} className={styles.axisLabel}><title>{labels[index]}</title>{formatChartDateTick(labels[index] ?? '')}</text>)}
        {hasValues && trendModels.map((item, index) => {
          const color = item.color ?? chartColors[index % chartColors.length];
          const path = buildObservedCurvePath(labels, item.trend.fittedValues, (value, index) => point(value, index, labels.length));
          const estimatedPath = buildEstimatedCurvePath(labels, item.plotValues, item.trend.outlierIndexes, (value, index) => point(value, index, labels.length));
          const outliers = new Set(item.trend.outlierIndexes);
          return (
            <g key={item.label}>
              {path && <path d={path} fill="none" stroke={color} className={`${styles.curve} ${styles.robustTrendCurve}`} style={{ animationDelay: `${index * 70}ms` }} />}
              {estimatedPath && <path d={estimatedPath} data-estimated="true" fill="none" stroke={color} strokeDasharray="6 5" className={styles.robustTrendCurve}><title>跨离群日的平滑估计，非实测值</title></path>}
              {item.values.map((value, pointIndex) => {
                if (!Number.isFinite(value)) return null;
                const rawPoint = point(item.plotValues[pointIndex]!, pointIndex, item.values.length);
                const isOutlier = outliers.has(pointIndex);
                const current = { ...rawPoint, y: isOutlier ? Math.max(padding.top, Math.min(chartHeight - padding.bottom, rawPoint.y)) : rawPoint.y };
                const labelOffset = index % 2 === 0 ? -11 : 21;
                return <g key={`${item.label}-${pointIndex}`} data-outlier={isOutlier || undefined} className={styles.chartPointGroup} style={{ animationDelay: `${Math.min(pointIndex * 16 + index * 45, 420)}ms` }}>{isOutlier && <circle cx={current.x} cy={current.y} r={activeIndex === pointIndex ? 9 : 7} fill="none" stroke={color} className={styles.chartPointOutlierHalo} />}<circle cx={current.x} cy={current.y} r={activeIndex === pointIndex ? 4.5 : isOutlier ? 3.4 : 2.6} fill={isOutlier ? '#fff' : color} stroke={isOutlier ? color : '#fff'} className={`${styles.chartPoint} ${isOutlier ? styles.chartPointOutlier : ''} ${activeIndex === pointIndex ? styles.chartPointActive : ''}`}><title>{`${labels[pointIndex] ?? ''} · ${item.label} ${Number(value.toFixed(2))}${isOutlier ? ' · 疑似离群，不参与拟合，真实值保留' : ''}`}</title></circle>{value < 0 && <text x={current.x} y={Math.max(16, current.y - 10)} textAnchor="middle" fill="#D05C50">↓</text>}{item.values.length === 1 && <text x={current.x + 17} y={current.y + labelOffset} fill={color} className={styles.singlePointValue}>{Number(value.toFixed(2))}</text>}</g>;
              })}
            </g>
          );
        })}
        {activeX != null && <line x1={activeX} x2={activeX} y1={padding.top} y2={chartHeight - padding.bottom} className={styles.activeGuide} />}
        {hasValues && labels.map((label, index) => {
          const center = xFor(index);
          const left = index === 0 ? padding.left : (xFor(index - 1) + center) / 2;
          const right = index === labels.length - 1 ? width - padding.right : (center + xFor(index + 1)) / 2;
          return <rect key={label} x={left} y={padding.top} width={Math.max(24, right - left)} height={chartHeight - padding.top - padding.bottom} className={styles.chartHitArea} tabIndex={0} aria-label={`${label}，查看该日所有指标`} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} />;
        })}
      </svg>
      {!hasValues && <div className={styles.trendPending}><span>NO DATA</span><strong>暂无趋势数据</strong><p>{pendingText ?? '当前筛选范围没有可用数据'}</p></div>}
      {activeX != null && activeIndex != null && activeSeries.length > 0 && <div className={styles.chartTooltip} data-scale={scaleMode} data-align={tooltipAlign} style={{ left: `${activeX / width * 100}%` }} role="status">
        <strong>{labels[activeIndex]}</strong>
        {activeSeries.map((item) => <span key={item.key ?? item.label}><i style={{ background: item.color }} /><b>{item.label}{item.isOutlier ? ' · 疑似离群' : ''}{scaleMode === 'trend' && <small>{reportDailyRate(item.values, labels, activeIndex)}{(item.isOutlier || item.trend.outlierIndexes.includes(activeIndex - 1)) && ' · 含疑似离群日'}</small>}</b><em>{scaleMode === 'trend' || item.isOutlier ? item.value.toLocaleString('zh-CN') : formatChartValue(item.value)}</em></span>)}
      </div>}
    </div>
  );
}

export function IncrementBarChart({ labels, values, height = 330 }: { labels: string[]; values: number[]; height?: number; raw?: boolean }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [chartRef, width] = useResponsiveChartWidth();
  const padding = { top: 34, right: 24, bottom: 44, left: 62 };
  const trend = useMemo(() => {
    const outlierIndexes = detectIncrementOutliers(values, labels);
    const omitted = new Set(outlierIndexes);
    return { fittedValues: values.map((value, index) => omitted.has(index) ? NaN : value), outlierIndexes };
  }, [values, labels]);
  const outliers = new Set(trend.outlierIndexes);
  // 正负由颜色和箭头表达，柱高只画变化幅度；孤立异常不能撑大正常柱的刻度。
  const domain = buildChartDomain([...trend.fittedValues.filter(Number.isFinite).map(Math.abs), 0], [0, Infinity]);
  const max = domain.max;
  const range = max || 1;
  const plotHeight = height - padding.top - padding.bottom;
  const plotWidth = width - padding.left - padding.right;
  const xStep = plotWidth / Math.max(1, labels.length);
  const barWidth = Math.max(6, Math.min(28, xStep * 0.56));
  const xFor = (index: number) => padding.left + xStep * index + xStep / 2;
  const yFor = (value: number) => padding.top + ((max - Math.abs(value)) / range) * plotHeight;
  const zeroY = yFor(0);
  const xTicks = buildDateTickIndexes(labels.length, plotWidth);
  const yTicks = Array.from({ length: 5 }, (_, index) => max - index * (range / 4));
  const activeValue = activeIndex == null ? null : values[activeIndex];
  const activeX = activeIndex == null ? null : xFor(activeIndex);
  const tooltipAlign = activeIndex === 0 ? 'start' : activeIndex === labels.length - 1 ? 'end' : 'center';
  const hasValues = labels.length > 0 && values.some(Number.isFinite);
  const trendPath = buildObservedCurvePath(labels, trend.fittedValues, (value, index) => ({ x: xFor(index), y: yFor(value) }));
  const estimatedPath = buildEstimatedCurvePath(labels, values, trend.outlierIndexes, (value, index) => ({ x: xFor(index), y: yFor(value) }));
  return <div ref={chartRef} className={styles.chartWrap} onMouseLeave={() => setActiveIndex(null)}>
    <div className={styles.incrementMeta}>
      <span><i data-tone="positive" />↑ 正增长</span>
      <span><i data-tone="negative" />↓ 负增长</span>
      <span><i data-tone="trend" />正常幅度平滑趋势</span>
      <small>幅度（绝对值）{outliers.size > 0 && ' · ○ 疑似离群 · 虚线：估计值'}</small>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.chart} role="group" aria-label="每日价敏用户净增柱状图">
      {yTicks.map((tick, index) => {
        const y = padding.top + index * (plotHeight / 4);
        return <g key={`${tick}-${index}`}><line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className={styles.gridLine} /><text x={padding.left - 12} y={y + 4} textAnchor="end" className={styles.axisLabel}>{formatChartValue(tick)}</text></g>;
      })}
      <line x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} className={styles.zeroLine} />
      {xTicks.map((index) => <text key={index} x={xFor(index)} y={height - 13} textAnchor={index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle'} className={styles.axisLabel}><title>{labels[index]}</title>{formatChartDateTick(labels[index] ?? '')}</text>)}
      {hasValues && values.map((value, index) => {
        if (!Number.isFinite(value)) return null;
        const rawValueY = yFor(value);
        const isOutlier = outliers.has(index);
        if (isOutlier) return <circle key={`${labels[index]}-${index}`} cx={xFor(index)} cy={14} r={5} fill="none" stroke="var(--text-3)" strokeWidth="1.5" data-outlier="true" tabIndex={0} role="button" aria-label={`${labels[index]}，价敏用户净增 ${Math.round(value)}`} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} onClick={() => setActiveIndex(index)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveIndex(index); } }}><title>{`${labels[index]} · 区间极端值 ${value.toLocaleString('zh-CN')} · 不参与主图刻度与拟合`}</title></circle>;
        const valueY = rawValueY;
        const direction = value > 0 ? 'positive' : value < 0 ? 'negative' : 'flat';
        return <g key={`${labels[index]}-${index}`}><rect
          key={`${labels[index]}-${index}`}
          x={xFor(index) - barWidth / 2}
          y={value === 0 ? zeroY - 1 : Math.min(valueY, zeroY)}
          width={barWidth}
          height={value === 0 ? 2 : Math.max(2, Math.abs(zeroY - valueY))}
          rx={Math.min(4, barWidth / 3)}
          className={`${styles.incrementBar} ${activeIndex === index ? styles.incrementBarActive : ''}`}
          data-direction={direction}
          style={{ animationDelay: `${Math.min(index * 18, 420)}ms` }}
          tabIndex={0}
          aria-label={`${labels[index]}，价敏用户净增 ${Math.round(value)}`}
          onMouseEnter={() => setActiveIndex(index)}
          onFocus={() => setActiveIndex(index)}
          onBlur={() => setActiveIndex(null)}
        />{value < 0 && <text x={xFor(index)} y={Math.max(18, valueY - 6)} textAnchor="middle" fill="#D05C50" pointerEvents="none">↓</text>}</g>;
      })}
      {hasValues && trendPath && <path d={trendPath} fill="none" className={styles.barTrendCurve} style={{ animationDelay: '260ms' }} />}
      {hasValues && estimatedPath && <path d={estimatedPath} data-estimated="true" fill="none" strokeDasharray="6 5" className={styles.barTrendCurve}><title>跨离群日的幅度估计，非实测值</title></path>}
    </svg>
    {!hasValues && <div className={styles.trendPending}><span>NO DATA</span><strong>暂无增量数据</strong><p>当前筛选范围没有连续的每日快照</p></div>}
    {activeIndex != null && activeX != null && activeValue != null && <div className={styles.chartTooltip} data-align={tooltipAlign} style={{ left: `${activeX / width * 100}%` }} role="status">
      <strong>{labels[activeIndex]}</strong>
      <span><i style={{ background: activeValue < 0 ? '#D05C50' : '#2F6FDB' }} /><b>价敏用户净增{outliers.has(activeIndex) ? ' · 疑似离群 / 区间极端值，已从主图分离（不代表数据错误）' : ''}</b><em>{`${activeValue > 0 ? '+' : ''}${Math.round(activeValue).toLocaleString('zh-CN')}`}</em></span>
    </div>}
  </div>;
}

export function DonutChart({ distribution, hidden, onToggle, centerLabel = '已有价敏指标用户' }: { distribution: Array<{ label: string; value: number }>; hidden: Set<string>; onToggle: (label: string) => void; centerLabel?: string }) {
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  if (distribution.length === 0) return <Empty description="暂无分布数据" />;
  const allTotal = distribution.reduce((sum, item) => sum + item.value, 0);
  const activeItem = activeLabel ? distribution.find((item) => item.label === activeLabel) : undefined;
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;
  return <div className={styles.donutLayout}>
    <svg viewBox="0 0 260 260" role="img" aria-label="报表扇形分布图" onMouseLeave={() => setActiveLabel(null)}>
      <circle cx="130" cy="130" r={radius} fill="none" stroke="var(--wb-surface-hover)" strokeWidth="30" />
      <g transform="rotate(-90 130 130)">{distribution.map((item, index) => {
        const isHidden = hidden.has(item.label);
        const length = (item.value / Math.max(allTotal, 1)) * circumference;
        const offset = -consumed;
        consumed += length;
        return <circle key={item.label} cx="130" cy="130" r={radius} fill="none" stroke={isHidden ? 'var(--report-donut-muted)' : (sensitivityColors[item.label] ?? '#8E8E93')} strokeWidth="30" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={offset} data-donut-sector data-state={isHidden ? 'disabled' : 'enabled'} className={`${styles.donutSegment} ${isHidden ? styles.donutSegmentMuted : ''} ${activeLabel === item.label ? styles.donutSegmentActive : ''}`} style={{ animationDelay: `${index * 90}ms` }} tabIndex={0} aria-label={`${item.label}: ${item.value.toLocaleString('zh-CN')} 人，${isHidden ? '已关闭' : '已显示'}`} onMouseEnter={() => setActiveLabel(item.label)} onFocus={() => setActiveLabel(item.label)} onBlur={() => setActiveLabel(null)} onClick={() => onToggle(item.label)} onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle(item.label);
          }
        }}><title>{`${item.label}: ${item.value.toLocaleString('zh-CN')} 人 · ${allTotal ? Number((item.value / allTotal * 100).toFixed(1)) : 0}% · ${isHidden ? '已关闭' : '已显示'}`}</title></circle>;
      })}</g>
      <text x="130" y="126" textAnchor="middle" className={styles.donutValue}>{compactCount(activeItem?.value ?? allTotal)}</text>
      <text x="130" y="149" textAnchor="middle" className={styles.donutLabel}>{activeItem ? `${activeItem.label}${hidden.has(activeItem.label) ? ' · 已关闭' : ''}` : centerLabel}</text>
    </svg>
    <div className={styles.donutLegend}>{distribution.map((item) => {
      const isHidden = hidden.has(item.label);
      return <button type="button" key={item.label} aria-pressed={!isHidden} data-state={isHidden ? 'disabled' : 'enabled'} className={`${isHidden ? styles.legendMuted : ''} ${activeLabel === item.label ? styles.donutLegendActive : ''}`} onMouseEnter={() => setActiveLabel(item.label)} onMouseLeave={() => setActiveLabel(null)} onFocus={() => setActiveLabel(item.label)} onBlur={() => setActiveLabel(null)} onClick={() => onToggle(item.label)}><i style={{ background: isHidden ? 'var(--report-donut-muted)' : (sensitivityColors[item.label] ?? '#8E8E93') }} /><b>{item.label}</b><em>{item.value.toLocaleString('zh-CN')} 人 · {allTotal ? Number((item.value / allTotal * 100).toFixed(1)) : 0}%</em></button>;
    })}</div>
  </div>;
}

interface PublicReportsWorkspaceProps {
  visible: boolean;
}

const PublicReportsWorkspace: React.FC<PublicReportsWorkspaceProps> = ({ visible }) => {
  const pageRef = useRef<HTMLElement>(null);
  const visibleRef = useRef(visible);
  useEffect(() => { visibleRef.current = visible; }, [visible]);
  const isAdmin = useAuthStore((state) => state.user?.is_admin ?? false);
  const access = useMemo(() => buildReportAccessPolicy(isAdmin), [isAdmin]);
  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [sources, setSources] = useState<ReportDataSource[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceView, setSourceView] = useState<'list' | 'detail'>('list');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState('');
  const [sourceFieldCount, setSourceFieldCount] = useState(0);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [sourceCatalogQuery, setSourceCatalogQuery] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingReportId, setEditingReportId] = useState('');
  const [searchDUID, setSearchDUID] = useState('');
  const [searchResult, setSearchResult] = useState<ReportPageResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [tableQuery, setTableQuery] = useState('');
  const [tableSort, setTableSort] = useState<ReportSort | null>(null);
  const [detailResult, setDetailResult] = useState<ReportPageResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailPage, setDetailPage] = useState(1);
  const [detailPageSize, setDetailPageSize] = useState(100);
  const [fieldGroup, setFieldGroup] = useState<ReportFieldGroup>('all');
  const [draftDashboardRange, setDraftDashboardRange] = useState<ReportAnalyticsRange>('all');
  const [activeSection, setActiveSection] = useState('report-overview');
  const [appliedDashboardRange, setAppliedDashboardRange] = useState<ReportAnalyticsRange>('all');
  const [snapshotReload, setSnapshotReload] = useState(0);
  const [analytics, setAnalytics] = useState<ReportAnalyticsResult | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const detailRequest = useRef(0);
  const [draftCities, setDraftCities] = useState<string[]>([]);
  const [appliedCities, setAppliedCities] = useState<string[]>([]);
  const [draftProvinceCodes, setDraftProvinceCodes] = useState<string[]>([]);
  const [appliedProvinceCodes, setAppliedProvinceCodes] = useState<string[]>([]);
  const expandedAppliedCities = useMemo(
    () => expandChinaRegionSelection(appliedCities, appliedProvinceCodes),
    [appliedCities, appliedProvinceCodes],
  );
  const [hiddenBusinessSeries, setHiddenBusinessSeries] = useState<Set<string>>(new Set(['d1', 'd2', 'd3']));
  const [hiddenDistribution, setHiddenDistribution] = useState<Set<string>>(new Set());
  const [sourceForm] = Form.useForm<SourceForm>();
  const [reportForm] = Form.useForm<ReportForm>();
  const filteredSources = useMemo(() => filterReportSources(sources, sourceCatalogQuery), [sources, sourceCatalogQuery]);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const nextReports = await listReports();
      const nextSources = access.canManageReports ? await listReportSources() : [];
      setReports(nextReports);
      setSources(nextSources);
      setSelectedId((current) => current || nextReports[0]?.id || '');
    } catch {
      if (visibleRef.current) message.error('加载报表失败');
    } finally {
      setLoading(false);
    }
  }, [access.canManageReports]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    if (!selectedId || !access.canViewRunHistory) { setRuns([]); return; }
    let active = true;
    setRuns([]);
    void listReportRuns(selectedId).then((result) => { if (active) setRuns(result); }).catch(() => {
      if (active && visibleRef.current) message.error('加载运行历史失败');
    });
    return () => { active = false; };
  }, [selectedId, access.canViewRunHistory]);
  const loadDetailPage = useCallback(async (reportId: string, page: number, size: number, notifyError = true) => {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    try {
      const result = await queryReportPage(reportId, page, size);
      if (request !== detailRequest.current) return;
      setDetailResult(result);
      setDetailPage(result.pagination.page || page);
    } catch {
      if (request === detailRequest.current && notifyError && visibleRef.current) message.error('读取全量明细失败，已保留最近快照');
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }, []);
  useEffect(() => {
    setTableQuery('');
    detailRequest.current += 1;
    setTableSort(null);
    setDetailResult(null);
    setDetailPage(1);
    setDetailPageSize(100);
    const defaultRange = reports.find((item) => item.id === selectedId)?.visualization.template?.profile === 'price_sensitive_v1_2' ? 'all' : '31d';
    setDraftDashboardRange(defaultRange);
    setAppliedDashboardRange(defaultRange);
    setDraftCities([]);
    setAppliedCities([]);
    setDraftProvinceCodes([]);
    setAppliedProvinceCodes([]);
    setAnalytics(null);
    setHiddenBusinessSeries(new Set(['d1', 'd2', 'd3']));
    setHiddenDistribution(new Set());
    const report = reports.find((item) => item.id === selectedId);
    setFieldGroup(report?.visualization.detail?.defaultGroup ?? 'all');
    setSearchDUID('');
    setSearchResult(null);
    if (selectedId && access.canBrowseFullDetail) void loadDetailPage(selectedId, 1, 100, false);
  }, [selectedId, reports, loadDetailPage, access.canBrowseFullDetail]);

  const selected = reports.find((item) => item.id === selectedId);
  const isV12 = selected?.visualization.template?.profile === 'price_sensitive_v1_2';
  const analyticsEnabled = selected?.visualization.analytics?.enabled === true;
  useEffect(() => {
    if (!selectedId || !analyticsEnabled) return;
    let active = true;
    setAnalyticsLoading(true);
    setAnalytics(null);
    setAnalyticsError('');
    if (isV12) {
      void loadStoredSnapshotHistory(queryReportAnalytics, selectedId, appliedDashboardRange, expandedAppliedCities, (result) => {
        if (active) setAnalytics(result);
      }, () => active)
        .catch((error: unknown) => { if (active) setAnalyticsError(error instanceof Error ? error.message : '读取 dt 历史失败'); })
        .finally(() => { if (active) setAnalyticsLoading(false); });
      return () => { active = false; };
    }
    void queryReportAnalytics(selectedId, appliedDashboardRange === 'all' ? '31d' : appliedDashboardRange, undefined, expandedAppliedCities)
      .then((result) => { if (active) setAnalytics(result); })
      .catch((error: unknown) => { if (active) { setAnalytics(null); setAnalyticsError(error instanceof Error ? error.message : '读取价敏趋势失败'); } })
      .finally(() => { if (active) setAnalyticsLoading(false); });
    return () => { active = false; };
  }, [selectedId, analyticsEnabled, appliedDashboardRange, expandedAppliedCities, isV12, snapshotReload]);
  const latest = runs.find((run) => run.status === 'succeeded');
  const snapshot = latest?.snapshot ?? [];
  const detailRows = detailResult?.rows ?? snapshot;
  const presentation = useMemo(() => buildReportPresentation(detailRows, selected?.visualization ?? {}), [detailRows, selected]);
  const analyticsPresentation = useMemo(() => analytics ? buildPriceSensitiveAnalyticsPresentation(analytics) : null, [analytics]);
  const visibleMetrics = analyticsEnabled ? (analyticsPresentation?.metrics ?? []) : presentation.metrics;
  const incrementSeries = analyticsPresentation?.incrementSeries ?? [];
  const cumulativeSeries = analyticsPresentation?.cumulativeSeries ?? [];
  const growthRateSeries = analyticsPresentation?.growthRateSeries ?? [];
  const scoreSeries = analyticsPresentation?.scoreSeries ?? [];
  const visibleScoreSeries = scoreSeries.filter((item) => !hiddenBusinessSeries.has(item.key));
  const businessAxisLabels = analyticsPresentation?.labels ?? [];
  const chartDistribution = analyticsEnabled ? analyticsPresentation?.distribution ?? [] : presentation.distribution;
  const detailPresentation = useMemo(() => buildReportPresentation(detailRows, selected?.visualization ?? {}), [detailRows, selected]);
  const orderedDetailColumns = useMemo(() => {
    const columns = detailPresentation.columns;
    return ['duid', 'dt', ...columns.filter((column) => column !== 'duid' && column !== 'dt')].filter((column) => columns.includes(column));
  }, [detailPresentation.columns]);
  const visibleColumns = useMemo(() => reportColumnsForGroup(orderedDetailColumns, fieldGroup), [orderedDetailColumns, fieldGroup]);
  const filteredRows = useMemo(() => filterAndSortReportRows(detailRows, tableQuery, tableSort), [detailRows, tableQuery, tableSort]);
  const tablePageCount = detailResult?.pagination.page_count || 1;
  const totalRows = detailResult?.pagination.total || snapshot.length;
  const sharedUserCount = analytics?.summary.calculated_user_count ?? 0;
  const activePartition = analytics?.data_date || detailResult?.source_partition || latest?.source_partition || analytics?.end_date || '—';
  const latestTime = analytics?.fetched_at ? new Date(analytics.fetched_at).toLocaleString('zh-CN', { hour12: false }) : latest
    ? new Date(latest.finished_at ?? latest.started_at).toLocaleString('zh-CN', { hour12: false })
    : analytics?.end_date ? `${analytics.end_date} 10:00` : '等待首次生成';
  const appliedCityLabel = summarizeChinaRegionSelection(appliedCities, appliedProvinceCodes);
  const selectedRangeLabel = rangeOptions.find((option) => option.value === appliedDashboardRange)?.label ?? '近 31 天';
  const analyticsDateRangeLabel = analytics?.start_date && analytics?.end_date
    ? `${analytics.start_date} → ${analytics.end_date}`
    : selectedRangeLabel;

  useEffect(() => {
    const root = pageRef.current;
    if (!root || !selected) return;
    const ids = ['report-overview', 'report-order-cohort', 'report-increments', 'report-trend', 'report-search'];
    if (access.canBrowseFullDetail) ids.push('report-detail');
    if (access.canViewRunHistory) ids.push('report-history');
    let frame = 0;
    const updateActiveSection = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const threshold = root.getBoundingClientRect().top + 150;
        const current = ids.reduce((active, id) => {
          const section = document.getElementById(id);
          return section && section.getBoundingClientRect().top <= threshold ? id : active;
        }, ids[0] ?? 'report-overview');
        setActiveSection(current);
      });
    };
    updateActiveSection();
    root.addEventListener('scroll', updateActiveSection, { passive: true });
    return () => {
      root.removeEventListener('scroll', updateActiveSection);
      cancelAnimationFrame(frame);
    };
  }, [selected, access.canBrowseFullDetail, access.canViewRunHistory]);

  const toggleTableSort = (column: string) => {
    setTableSort((current) => current?.column !== column
      ? { column, direction: 'asc' }
      : current.direction === 'asc'
        ? { column, direction: 'desc' }
        : null);
  };

  const toggleBusinessSeries = (key: string, groupKeys: string[]) => {
    setHiddenBusinessSeries((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (groupKeys.some((candidate) => candidate !== key && !next.has(candidate))) next.add(key);
      return next;
    });
  };

  const applyDashboardFilters = () => {
    setAppliedCities(draftCities);
    setAppliedProvinceCodes(draftProvinceCodes);
    setAppliedDashboardRange(draftDashboardRange);
    message.success(draftCities.length > 0 || draftProvinceCodes.length > 0 ? '区域与时间筛选已应用' : '已切换为全部城市');
  };

  const resetDashboardFilters = () => {
    setDraftCities([]);
    setAppliedCities([]);
    setDraftProvinceCodes([]);
    setAppliedProvinceCodes([]);
    setDraftDashboardRange(isV12 ? 'all' : '7d');
    setAppliedDashboardRange(isV12 ? 'all' : '7d');
  };

  const toggleDistribution = (label: string) => {
    setHiddenDistribution((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else if (next.size < Math.max(0, chartDistribution.length - 1)) next.add(label);
      return next;
    });
  };

  const handleRun = async () => {
    if (!selectedId) return;
    setRunning(true);
    try {
      const completedRun = await runReport(selectedId, isV12 ? '1d' : appliedDashboardRange === 'all' ? '31d' : appliedDashboardRange, expandedAppliedCities);
      setRuns(await listReportRuns(selectedId));
      await loadDetailPage(selectedId, 1, detailPageSize, false);
      if (analyticsEnabled && isV12) setSnapshotReload((value) => value + 1);
      if (analyticsEnabled && !isV12) {
        setAnalytics(await queryReportAnalytics(selectedId, appliedDashboardRange === 'all' ? '31d' : appliedDashboardRange, completedRun.source_partition, expandedAppliedCities));
        setAnalyticsError('');
      }
      message.success(isV12 ? '最新快照已刷新，所选 dt 历史正在逐日加载' : '报表生成完成');
    } catch (error: unknown) {
      setRuns(await listReportRuns(selectedId).catch(() => []));
      message.error(error instanceof Error ? error.message : '报表生成失败');
    } finally {
      setRunning(false);
    }
  };
  const handleSearch = async () => {
    const duid = searchDUID.trim();
    if (!selectedId || !/^\d+$/.test(duid)) {
      message.warning('请输入完整的数字 DUID');
      return;
    }
    setSearchLoading(true);
    try {
      setSearchResult(await queryReportSearch(selectedId, duid));
    } catch {
      setSearchResult(null);
      message.error('查询失败，请检查 DUID 后重试');
    } finally {
      setSearchLoading(false);
    }
  };
  const loadSourceContract = useCallback(async (sourceId: string) => {
    if (!sourceId) {
      setEditingSourceId('');
      setSourceFieldCount(0);
      sourceForm.resetFields();
      sourceForm.setFieldsValue({ enabled: true });
      return;
    }
    const contract = await getReportSourceContract(sourceId);
    setEditingSourceId(sourceId);
    setSourceFieldCount(contract.fields.length);
    sourceForm.setFieldsValue(contract);
  }, [sourceForm]);

  const openSourceManager = () => {
    setSourceView('list');
    setEditingSourceId('');
    setSourceFieldCount(0);
    setSourceCatalogQuery('');
    sourceForm.resetFields();
    setSourceOpen(true);
  };

  const openSourceDetail = async (sourceId: string) => {
    setSourceView('detail');
    setSourceLoading(true);
    try {
      await loadSourceContract(sourceId);
    } catch {
      message.error('加载数据源契约失败');
      setSourceView('list');
    } finally {
      setSourceLoading(false);
    }
  };

  const openNewSource = () => {
    setEditingSourceId('');
    setSourceFieldCount(0);
    sourceForm.resetFields();
    sourceForm.setFieldsValue({ enabled: true });
    setSourceView('detail');
  };

  const closeSourceManager = () => {
    setSourceOpen(false);
    setSourceView('list');
    setSourceCatalogQuery('');
  };

  const saveSource = async () => {
    const values = await sourceForm.validateFields();
    setSourceSaving(true);
    try {
      let sourceId = editingSourceId;
      if (!sourceId) {
        const created = await createReportSource({
          name: values.name,
          description: values.description,
          endpoint: values.endpoint,
          api_name: values.api_name,
          app_key_env: values.app_key_env,
          signature_env: values.signature_env,
          x_date_env: values.x_date_env ?? '',
          enabled: values.enabled,
        });
        sourceId = created.id;
      }
      const saved = await saveReportSourceContract(sourceId, {
        source_id: sourceId,
        name: values.name,
        description: values.description,
        endpoint: values.endpoint,
        api_name: values.api_name,
        app_key_env: values.app_key_env,
        signature_env: values.signature_env,
        x_date_env: values.x_date_env ?? '',
        api_example: values.api_example,
        response_example: values.response_example,
        hive_table: values.hive_table,
        hive_ddl: values.hive_ddl,
        hive_example: values.hive_example,
        enabled: values.enabled,
        fields: [],
      });
      setEditingSourceId(sourceId);
      setSourceFieldCount(saved.fields.length);
      await loadCatalog();
      message.success(`数据源契约已保存，共解析 ${saved.fields.length} 个字段`);
    } finally {
      setSourceSaving(false);
    }
  };
  const saveReport = async () => {
    const values = await reportForm.validateFields();
    try {
      const body = { name: values.name, description: values.description ?? '', data_source_id: values.data_source_id, query: JSON.parse(values.query) as Record<string, unknown>, visualization: JSON.parse(values.visualization) as ReportVisualization, enabled: values.enabled };
      if (editingReportId) await updateReport(editingReportId, body);
      else await createReport(body);
    } catch (error) {
      if (error instanceof SyntaxError) { message.error('查询或图表配置不是合法 JSON'); return; }
      throw error;
    }
    setReportOpen(false);
    setEditingReportId('');
    reportForm.resetFields();
    await loadCatalog();
    message.success(editingReportId ? '报表已更新' : '报表已创建');
  };

  const openCreateReport = () => {
    setEditingReportId('');
    reportForm.setFieldsValue({ name: '', description: '', data_source_id: sources[0]?.id, query: defaultQuery, visualization: defaultVisualization, enabled: true });
    setReportOpen(true);
  };

  const openEditReport = () => {
    if (!selected) return;
    setEditingReportId(selected.id);
    reportForm.setFieldsValue({
      name: selected.name, description: selected.description, data_source_id: selected.data_source_id,
      query: JSON.stringify(selected.query, null, 2), visualization: JSON.stringify(selected.visualization, null, 2), enabled: selected.enabled,
    });
    setReportOpen(true);
  };

  if (loading) return <div className={styles.loading}><Spin size="large" /></div>;
  return (
    <main ref={pageRef} className={styles.page}>
      <header className={styles.sectionHead}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionLine} />
          <div><h1>数据报表</h1><p>固定业务口径 · 每日 10:00 更新 · 可追溯数据快照</p></div>
        </div>
        <div className={styles.actions}>
          {access.canManageReports && <Button onClick={() => setTemplateOpen(true)}>套用模板</Button>}
          {access.canManageReports && <><Button icon={<CloudServerOutlined />} onClick={openSourceManager}>数据源</Button><Button icon={<PlusOutlined />} onClick={openCreateReport}>新建报表</Button><Button icon={<EditOutlined />} disabled={!selected} onClick={openEditReport}>编辑当前报表</Button><Button type="primary" icon={<PlayCircleOutlined />} loading={running} disabled={!selected} onClick={() => void handleRun()}>立即生成</Button></>}
        </div>
      </header>

      <section className={styles.workspace}>
        <aside className={styles.reportRail}>
          <div className={styles.railTitle}><span>报表目录</span><b>{reports.length}</b></div>
          {reports.map((report) => (
            <button key={report.id} type="button" className={`${styles.reportItem} ${report.id === selectedId ? styles.reportItemActive : ''}`} onClick={() => setSelectedId(report.id)}>
              <BarChartOutlined />
              <span><strong>{report.name}</strong><small>{report.description || '固定业务报表'}</small></span>
            </button>
          ))}
          {reports.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无报表" />}
          <div className={styles.railFoot}><span>DATA UPDATE</span><strong>{latestTime}</strong></div>
        </aside>

        <div className={styles.dashboard}>
          {selected ? <>
            <section className={styles.summaryHero}>
              <div>
                <span className={styles.eyebrow}>REPORT OVERVIEW · BUSINESS INSIGHT</span>
                <h2>{selected.name}</h2>
                <p>{selected.description || '基于固定数据接口生成的业务报表'}</p>
                <div className={styles.summaryMeta}>
                  <span>数据分区 {activePartition}</span>
                  <span>{access.canBrowseFullDetail ? `${totalRows.toLocaleString('zh-CN')} 行数据` : `${sharedUserCount.toLocaleString('zh-CN')} 位已计算用户`}</span>
                  <span>更新于 {latestTime}</span>
                  {selected.visualization.template && <span>{selected.visualization.template.id === 'template-1' ? '模板一' : selected.visualization.template.id} · v{selected.visualization.template.version}</span>}
                  {!!analytics?.missing_dates?.length && <span>缺失 {analytics.missing_dates.length} 天</span>}
                </div>
              </div>
              {access.canBrowseFullDetail && latest && <Button icon={<DownloadOutlined />} onClick={() => void downloadReportRun(selected.id, latest.id)}>下载明细</Button>}
            </section>

            <nav className={styles.anchorBar} aria-label="报表板块导航">
              <a className={activeSection === 'report-overview' ? styles.anchorActive : ''} href="#report-overview" onClick={() => setActiveSection('report-overview')}>{isV12 ? '全量人群' : '指标概览'}</a>
              {isV12 && <a className={activeSection === 'report-order-cohort' ? styles.anchorActive : ''} href="#report-order-cohort" onClick={() => setActiveSection('report-order-cohort')}>价敏人群分布</a>}
              {isV12 && <a className={activeSection === 'report-increments' ? styles.anchorActive : ''} href="#report-increments" onClick={() => setActiveSection('report-increments')}>增量分析</a>}
              <a className={activeSection === 'report-trend' ? styles.anchorActive : ''} href="#report-trend" onClick={() => setActiveSection('report-trend')}>{isV12 ? 'dt 历史趋势' : '趋势分析'}</a>
              <a className={activeSection === 'report-search' ? styles.anchorActive : ''} href="#report-search" onClick={() => setActiveSection('report-search')}>用户查询</a>
              {access.canBrowseFullDetail && <a className={activeSection === 'report-detail' ? styles.anchorActive : ''} href="#report-detail" onClick={() => setActiveSection('report-detail')}>数据明细</a>}
              {access.canViewRunHistory && <a className={activeSection === 'report-history' ? styles.anchorActive : ''} href="#report-history" onClick={() => setActiveSection('report-history')}>运行记录</a>}
            </nav>

            <section className={styles.filterDock} aria-label="报表全局筛选">
              <div className={styles.filterIntro}>
                <span><FilterOutlined /></span>
                <div><strong>分析筛选</strong></div>
              </div>
              <div className={styles.filterFields}>
                <label className={styles.filterField}>
                  <span><EnvironmentOutlined />城市</span>
                  <div className={styles.cityPickerControl}>
                    <Select
                      mode="tags"
                      allowClear
                      maxTagCount={1}
                      maxTagPlaceholder={(omitted) => `+${omitted.length} 城市`}
                      value={draftCities}
                      options={cityOptions}
                      placeholder={draftProvinceCodes.length > 0 ? `已选 ${draftProvinceCodes.length} 个省级区域` : '全部城市'}
                      onChange={setDraftCities}
                      aria-label="选择城市"
                    />
                  </div>
                </label>
                <div className={styles.filterField}>
                  <span>时间范围</span>
                  <div className={styles.rangeControl} role="tablist" aria-label="选择时间范围">
                    {rangeOptions.filter((option) => isV12 || (option.value !== '1d' && option.value !== 'all')).map((option) => <button key={option.value} type="button" role="tab" aria-selected={draftDashboardRange === option.value} className={draftDashboardRange === option.value ? styles.rangeActive : ''} onClick={() => setDraftDashboardRange(option.value)}>{option.label}</button>)}
                  </div>
                </div>
              </div>
              <div className={styles.filterMap}>
                <ChinaRegionPicker
                  value={draftCities}
                  onChange={setDraftCities}
                  provinceCodes={draftProvinceCodes}
                  onProvinceChange={setDraftProvinceCodes}
                />
              </div>
              <div className={styles.filterActions}>
                <small>当前查看：{appliedCityLabel} · {selectedRangeLabel}</small>
                <Button icon={<ReloadOutlined />} onClick={resetDashboardFilters}>重置</Button>
                <Button type="primary" icon={<FilterOutlined />} onClick={applyDashboardFilters}>应用筛选</Button>
              </div>
            </section>

            {isV12 ? <ReportCohortSections key={selectedId} analytics={analytics} loading={analyticsLoading} error={analyticsError}
              renderChart={(labels, series, mode) => mode === 'trend' ? <ReportLaneTrends labels={labels} series={series} /> : <SmoothChart labels={labels} series={series} scaleMode={mode} height={270} trendRule="raw" pendingText="请开启至少一个图例" />}
              renderGrowthChart={(labels, series) => <SmoothChart labels={labels} series={series} height={270} trendRule="raw" pendingText="暂无连续快照可计算增长" />}
              renderBar={(labels, values) => <IncrementBarChart labels={labels} values={values} raw />}
              renderDistribution={(items, hidden, onToggle, centerLabel) => <DonutChart distribution={items} hidden={hidden} onToggle={onToggle} centerLabel={centerLabel} />} /> : <>
            <section className={`${styles.summaryBlock} ${styles.overviewBlock}`} id="report-overview">
              {analyticsError && <Alert type="warning" showIcon message="统计数据暂未生成" description={analyticsError} />}
              <div className={styles.blockHead}><div><span>01</span><strong>指标概览</strong></div><small>全量固定业务口径</small></div>
              {visibleMetrics.length > 0 ? <div className={styles.metrics}>{visibleMetrics.map((metric) => <article key={metric.label} className={styles.metricCard} data-direction={metric.value.startsWith('+') ? 'up' : metric.value.startsWith('-') ? 'down' : 'flat'}><span>{metric.label}</span><strong>{metric.value}<small>{metric.suffix}</small></strong><i /></article>)}</div> : <div className={styles.emptyCard}><Empty description="暂无可用指标数据" /></div>}
            </section>

            <section className={`${styles.summaryBlock} ${styles.trendBlock}`} id="report-trend">
              <div className={styles.blockHead}><div><span>02</span><strong>增量分析</strong></div><small>{appliedCityLabel} · {analyticsDateRangeLabel} · 相邻观察日净变化</small></div>
              <Spin spinning={analyticsLoading}>
              <div className={styles.chartGrid}>
                <div className={`${styles.card} ${styles.trendCard}`}>
                  <div className={styles.cardTitle}><div><i />每日价敏用户净增</div><small>单位：人</small></div>
                  <IncrementBarChart labels={businessAxisLabels} values={incrementSeries[0]?.values ?? []} raw={isV12} />
                </div>
                <div className={`${styles.card} ${styles.incrementAnalysisCard}`}>
                  <div className={styles.cardTitle}><div><i />累计与增长效率</div></div>
                  <div className={styles.volumeTrendGrid}>
                    <section className={styles.volumeTrendPanel}>
                      <header><span><i style={{ background: '#15857A' }} />累计净增</span><small>较期初 · 人</small></header>
                      <SmoothChart labels={businessAxisLabels} series={cumulativeSeries} trendRule={isV12 ? 'raw' : 'nondecreasing'} height={270} pendingText="暂无连续快照，无法计算累计净增" />
                    </section>
                    <section className={styles.volumeTrendPanel}>
                      <header><span><i style={{ background: '#765BC4' }} />每日增长率</span><small>单位：%</small></header>
                      <SmoothChart labels={businessAxisLabels} series={growthRateSeries} trendRule={isV12 ? 'raw' : 'nonnegative'} height={270} pendingText="暂无连续快照，无法计算增长率" />
                    </section>
                  </div>
                </div>
                <div className={`${styles.card} ${styles.scoreCard}`}>
                  <div className={styles.cardTitle}><div><i />{isV12 ? '价敏标签每日得分' : '180 天窗口得分参考'}</div><div className={styles.legend}>{scoreSeries.map((item, index) => {
                    return <button type="button" key={item.key} aria-pressed={!hiddenBusinessSeries.has(item.key)} className={hiddenBusinessSeries.has(item.key) ? styles.legendMuted : ''} onClick={() => toggleBusinessSeries(item.key, scoreSeries.map((series) => series.key))}><i style={{ background: item.color ?? chartColors[index % chartColors.length] }} />{item.label}</button>;
                  })}</div></div>
                  <SmoothChart labels={businessAxisLabels} series={visibleScoreSeries} trendRule={isV12 ? 'raw' : 'default'} bounds={[0, 100]} height={300} pendingText="当前筛选范围暂无可用的价敏得分趋势" />
                </div>
                <div className={`${styles.card} ${styles.distributionCard}`}>
                  <div className={styles.cardTitle}><div><i />价敏等级分布</div></div>
                  <DonutChart distribution={chartDistribution} hidden={hiddenDistribution} onToggle={toggleDistribution} />
                </div>
              </div>
              </Spin>
            </section>

            </>}
            <section className={`${styles.summaryBlock} ${styles.fullWidthBlock}`} id="report-search">
              <div className={styles.blockHead}><div><span>{isV12 ? '05' : '03'}</span><strong>用户查询</strong></div><small>输入完整 DUID · 仅返回精确匹配结果</small></div>
              <div className={`${styles.card} ${styles.searchCard}`}>
                <div className={styles.userSearchBar}>
                  <Input prefix={<SearchOutlined />} value={searchDUID} onChange={(event) => setSearchDUID(event.target.value.replace(/\D/g, ''))} onPressEnter={() => void handleSearch()} placeholder="请输入完整 DUID，例如 17592356441816" />
                  <Button type="primary" icon={<SearchOutlined />} loading={searchLoading} onClick={() => void handleSearch()}>查询用户</Button>
                </div>
                {searchResult ? (searchResult.rows.length > 0 ? <div className={styles.searchResult}>
                  <div className={styles.searchResultHead}><strong>查询结果</strong><span>{searchResult.rows.length} 条精确匹配 · 数据分区 {searchResult.source_partition || '—'}</span></div>
                  <div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr>{Object.keys(searchResult.rows[0] ?? {}).map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{searchResult.rows.map((row, rowIndex) => <tr key={rowIndex}>{Object.keys(searchResult.rows[0] ?? {}).map((column) => <td key={column} title={formatCell(row[column])}>{formatCell(row[column])}</td>)}</tr>)}</tbody></table></div>
                </div> : <Empty description="未找到对应 DUID" />) : <div className={styles.searchHint}><SearchOutlined /><span>普通用户只能通过完整 DUID 查询，不开放全量明细浏览</span></div>}
              </div>
            </section>

            {access.canBrowseFullDetail && <section className={`${styles.summaryBlock} ${styles.fullWidthBlock}`} id="report-detail">
              <div className={styles.blockHead}><div><span>{isV12 ? '06' : '04'}</span><strong>数据明细</strong></div><small>全量数据 · 服务端分页 · 共 {totalRows.toLocaleString('zh-CN')} 行</small></div>
              <div className={`${styles.card} ${styles.tableCard}`}>
                {orderedDetailColumns.length > 20 && <div className={styles.fieldGroups}>{fieldGroups.map((group) => <button key={group.value} type="button" className={fieldGroup === group.value ? styles.fieldGroupActive : ''} onClick={() => setFieldGroup(group.value)}>{group.label}<span>{reportColumnsForGroup(orderedDetailColumns, group.value).length}</span></button>)}</div>}
                <div className={styles.tableToolbar}>
                  <Input allowClear prefix={<SearchOutlined />} value={tableQuery} onChange={(event) => setTableQuery(event.target.value)} placeholder="搜索当前页的任意字段" />
                  <div><span>本页 {filteredRows.length} / {detailRows.length} 行 · {visibleColumns.length} 列</span><Select value={detailPageSize} onChange={(value) => { setDetailPageSize(value); void loadDetailPage(selectedId, 1, value); }} options={[{ value: 50, label: '50 行/页' }, { value: 100, label: '100 行/页' }]} /></div>
                </div>
                <Spin spinning={detailLoading}>{filteredRows.length > 0 ? <div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr>{visibleColumns.map((column) => <th key={column}><button type="button" className={styles.sortButton} onClick={() => toggleTableSort(column)}>{column}<span>{tableSort?.column === column ? (tableSort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>)}</tr></thead><tbody>{filteredRows.map((row, rowIndex) => <tr key={`${detailPage}-${rowIndex}`}>{visibleColumns.map((column) => <td key={column} title={formatCell(row[column])}>{formatCell(row[column])}</td>)}</tr>)}</tbody></table></div> : <Empty description={detailRows.length > 0 ? '当前页没有匹配的数据' : '暂无明细数据'} />}</Spin>
                <div className={styles.tableFooter}><span>第 {detailPage.toLocaleString('zh-CN')} / {tablePageCount.toLocaleString('zh-CN')} 页 · 共 {totalRows.toLocaleString('zh-CN')} 行</span><div><Button size="small" loading={detailLoading} disabled={detailPage <= 1} onClick={() => void loadDetailPage(selectedId, Math.max(1, detailPage - 1), detailPageSize)}>上一页</Button><Button size="small" loading={detailLoading} disabled={detailPage >= tablePageCount} onClick={() => void loadDetailPage(selectedId, Math.min(tablePageCount, detailPage + 1), detailPageSize)}>下一页</Button></div></div>
              </div>
            </section>}

            {access.canViewRunHistory && <section className={`${styles.summaryBlock} ${styles.fullWidthBlock}`} id="report-history">
              <div className={styles.blockHead}><div><span>{isV12 ? '07' : '05'}</span><strong>运行记录</strong></div></div>
              <div className={styles.card}>
                <div className={styles.runList}>{runs.map((run) => <div key={run.id} className={styles.runRow}><span className={`${styles.statusDot} ${styles[run.status]}`} /><strong>{statusLabel[run.status]}</strong><span>{run.trigger === 'scheduled' ? '每日 10:00' : '手动生成'}</span><span>{new Date(run.started_at).toLocaleString('zh-CN', { hour12: false })}</span><span>{run.source_partition || run.error_message || '—'}</span></div>)}{runs.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有运行记录" />}</div>
              </div>
            </section>}
          </> : <div className={styles.emptyCard}><Empty description="先创建一份报表" /></div>}
        </div>
      </section>

      <Modal
        title={sourceView === 'list' ? '选择数据源' : '数据源详情'}
        width={sourceView === 'list' ? 780 : 920}
        open={sourceOpen}
        onCancel={closeSourceManager}
        onOk={sourceView === 'detail' ? () => void saveSource() : undefined}
        okText="保存并解析字段"
        cancelText="关闭"
        footer={sourceView === 'list' ? null : undefined}
        confirmLoading={sourceSaving}
        okButtonProps={{ disabled: sourceLoading }}
        styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
      >
        {sourceView === 'list' ? (
          <div className={styles.sourcePicker}>
            <div className={styles.sourcePickerIntro}>
              <div><strong>数据源目录</strong><p>先选择数据源，再查看接口、字段和 Hive 配置。</p></div>
              <Button type="primary" icon={<PlusOutlined />} onClick={openNewSource}>新增数据源</Button>
            </div>
            {sources.length > 0 ? <>
              <div className={styles.sourceSearch}>
                <Input allowClear size="large" prefix={<SearchOutlined />} value={sourceCatalogQuery} onChange={(event) => setSourceCatalogQuery(event.target.value)} placeholder="查询数据源名称、中文用途或 API Name" aria-label="查询数据源" />
                <span>{filteredSources.length} / {sources.length}</span>
              </div>
              {filteredSources.length > 0 ? <div className={styles.sourceGrid}>{filteredSources.map((source) => (
                <button key={source.id} type="button" className={styles.sourceCard} onClick={() => void openSourceDetail(source.id)}>
                  <span className={styles.sourceCardIcon}><DatabaseOutlined /></span>
                  <span className={styles.sourceCardBody}>
                    <strong>{source.name}</strong>
                    <span className={styles.sourceDescription}>{source.description || '尚未添加中文用途说明'}</span>
                    <span className={styles.sourceMeta}><code>{source.api_name}</code><em data-enabled={source.enabled}>{source.enabled ? '已启用' : '已停用'}</em></span>
                  </span>
                  <RightOutlined className={styles.sourceCardArrow} />
                </button>
              ))}</div> : <div className={styles.sourceEmpty}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的数据源" /><Button onClick={() => setSourceCatalogQuery('')}>清除查询</Button></div>}
            </> : <div className={styles.sourceEmpty}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有数据源" /><Button type="primary" onClick={openNewSource}>创建第一个数据源</Button></div>}
          </div>
        ) : (
          <Spin spinning={sourceLoading}>
            <div className={styles.sourceDetailHead}>
              <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => setSourceView('list')}>返回数据源</Button>
              <div><span className={styles.sourceDetailIcon}><DatabaseOutlined /></span><div><strong>{editingSourceId ? sourceForm.getFieldValue('name') || '数据源详情' : '新增数据源'}</strong><p>{editingSourceId ? '编辑用途、接口与字段调用契约' : '配置一个新的业务数据接口'}</p></div></div>
            </div>
            <Form form={sourceForm} layout="vertical" initialValues={{ enabled: true }}>
              <section className={styles.sourceFormSection}>
                <div className={styles.sourceFormSectionTitle}><strong>基础信息</strong><span>用于列表识别和运行时连接</span></div>
                <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="epower_platform.price_sensitive" /></Form.Item>
                <Form.Item name="description" label="中文用途说明" rules={[{ required: true, message: '请填写数据源用途' }]}><Input.TextArea rows={2} placeholder="例如：充电用户价敏标签，提供 DUID 粒度的价敏得分与分层结果" /></Form.Item>
                <Form.Item name="endpoint" label="网关地址" rules={[{ required: true }]}><Input placeholder="http://10.x.x.x:8000" /></Form.Item>
                <Form.Item name="api_name" label="API Name" rules={[{ required: true }]}><Input placeholder="price_sensitive" /></Form.Item>
                <div className={styles.sourceFormGrid}>
                  <Form.Item name="app_key_env" label="App Key 环境变量" rules={[{ required: true }]}><Input placeholder="REPORT_PRICE_APP_KEY" /></Form.Item>
                  <Form.Item name="signature_env" label="签名环境变量" rules={[{ required: true }]}><Input placeholder="REPORT_PRICE_SIGN" /></Form.Item>
                </div>
                <Form.Item name="x_date_env" label="签名日期环境变量（仅联调）" extra="静态签名回放时填写；签名值本身不要粘贴到示例中"><Input placeholder="REPORT_PRICE_SIGN_DATE" /></Form.Item>
                <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
              </section>
              <details className={styles.sourceDisclosure}>
                <summary><span><strong>API 调用与返回</strong><small>脱敏后的 curl 和返回样例</small></span><em>展开</em></summary>
                <div className={styles.sourceDisclosureBody}>
                  <Form.Item name="api_example" label="API 调用示例"><Input.TextArea rows={8} placeholder="粘贴脱敏后的 curl 示例" /></Form.Item>
                  <Form.Item name="response_example" label="API 返回样例"><Input.TextArea rows={8} placeholder="粘贴返回 JSON 样例" /></Form.Item>
                </div>
              </details>
              <details className={styles.sourceDisclosure}>
                <summary><span><strong>Hive 表与字段契约</strong><small>当前已解析 {sourceFieldCount} 个可调用字段</small></span><em>展开</em></summary>
                <div className={styles.sourceDisclosureBody}>
                  <Form.Item name="hive_table" label="Hive 表名称" rules={[{ required: true }]}><Input placeholder="epower_platform.price_sensitive" /></Form.Item>
                  <Form.Item name="hive_ddl" label="Hive 建表语句" extra="保存时自动解析可调用字段" rules={[{ required: true }]}><Input.TextArea rows={12} placeholder="粘贴 CREATE TABLE 语句" /></Form.Item>
                  <Form.Item name="hive_example" label="SQL 调用示例"><Input.TextArea rows={6} placeholder="SELECT ..." /></Form.Item>
                </div>
              </details>
            </Form>
          </Spin>
        )}
      </Modal>
      <Modal title={editingReportId ? '编辑固定报表' : '新增固定报表'} width={720} open={reportOpen} onCancel={() => { setReportOpen(false); setEditingReportId(''); }} onOk={() => void saveReport()} okText="保存">
        <Form form={reportForm} layout="vertical" initialValues={{ query: defaultQuery, visualization: defaultVisualization, enabled: true }}><Form.Item name="name" label="报表名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="description" label="说明"><Input /></Form.Item><Form.Item name="data_source_id" label="数据源" rules={[{ required: true }]}><Select options={sources.map((source) => ({ value: source.id, label: `${source.name} · ${source.api_name}` }))} /></Form.Item><Form.Item name="query" label="查询配置 JSON" rules={[{ required: true }]}><Input.TextArea rows={8} /></Form.Item><Form.Item name="visualization" label="图表配置 JSON" rules={[{ required: true }]}><Input.TextArea rows={8} /></Form.Item><Form.Item name="enabled" label="每天 10:00 自动运行" valuePropName="checked"><Switch /></Form.Item></Form>
      </Modal>
      {access.canManageReports && <ReportTemplateModal open={templateOpen} sources={sources} onClose={() => setTemplateOpen(false)}
        onApplied={(report) => {
          setReports((current) => [report, ...current.filter((item) => item.id !== report.id)]);
          setSelectedId(report.id);
          message.success('已套用模板，正在读取真实报表数据');
        }} />}
    </main>
  );
};

const ReportsView: React.FC = () => {
  const [workspace, setWorkspace] = useState<'public' | 'personal'>('public');
  const [personalVisited, setPersonalVisited] = useState(false);

  const selectWorkspace = (next: 'public' | 'personal') => {
    if (next === 'personal') setPersonalVisited(true);
    setWorkspace(next);
  };

  return (
    <div className={styles.reportHub}>
      <nav className={styles.reportHubTabs} aria-label="报表中心">
        <button type="button" aria-current={workspace === 'public' ? 'page' : undefined} onClick={() => selectWorkspace('public')}>公共报表</button>
        <button type="button" aria-current={workspace === 'personal' ? 'page' : undefined} onClick={() => selectWorkspace('personal')}>我的报表</button>
      </nav>
      <div className={workspace === 'public' ? styles.reportHubPane : styles.reportHubPaneHidden}>
        <PublicReportsWorkspace visible={workspace === 'public'} />
      </div>
      {personalVisited && (
        <div className={workspace === 'personal' ? styles.reportHubPane : styles.reportHubPaneHidden}>
          <PersonalReportsLibrary />
        </div>
      )}
    </div>
  );
};

export default ReportsView;

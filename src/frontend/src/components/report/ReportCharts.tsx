import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Empty } from 'antd';
import { buildChartDomain, buildDateTickIndexes, formatChartDateTick } from '@/views/reportPresentation';
import { buildDonutArcPath } from './donutArc';
import { formatReportAxisTick } from '@/views/reportAxisTick';
import { normalizeReportTrend, reportDailyRate, type ReportScaleMode } from '@/views/reportTrendScale';
import { detectIncrementOutliers, detectReportOutliers } from '@/views/reportOutliers';
import { buildEstimatedCurvePath, buildObservedCurvePath } from '@/views/reportCurvePath';
import { fitReportLocalTrend } from '@/views/reportLocalFit';
import styles from '@/views/ReportsView.module.css';

export const chartColors = ['#2F6FDB', '#15857A', '#765BC4', '#D18A24', '#D05C50'];
const sensitivityColors: Record<string, string> = { 极高价敏: '#A63437', 高价敏: '#D75A50', 中高价敏: '#DB843C', 中价敏: '#D79A2B', 中低价敏: '#259F9A', 低价敏: '#4B78D1', 极低价敏: '#7B9ECA', 未知: '#8B8E95' };
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
    const locallyFitted = item.key === 'dailyNet' || item.key === 'growthRate';
    const fittedValues = locallyFitted ? fitReportLocalTrend(plotValues, labels, outlierIndexes) : plotValues.map((value, index) => outliers.has(index) ? NaN : value);
    return { ...item, plotValues, locallyFitted, trend: { fittedValues, outlierIndexes } };
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
      {trendModels.some((item) => item.locallyFitted) && <div className={styles.singleDayHint}>曲线：7日局部平滑拟合 · 散点/悬停：真实值</div>}
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
          const bridgeValues = item.locallyFitted ? item.trend.fittedValues.map((value, i) => item.trend.outlierIndexes.includes(i) ? item.plotValues[i]! : value) : item.plotValues;
          const estimatedPath = buildEstimatedCurvePath(labels, bridgeValues, item.trend.outlierIndexes, (value, index) => point(value, index, labels.length));
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

export function IncrementBarChart({ labels, values, height = 330, valueLabel = '价敏用户净增', growthTerminology = true, showTrend = true }: { labels: string[]; values: number[]; height?: number; raw?: boolean; valueLabel?: string; growthTerminology?: boolean; showTrend?: boolean }) {
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
      <span><i data-tone="positive" />↑ {growthTerminology ? '正增长' : '正值'}</span>
      <span><i data-tone="negative" />↓ {growthTerminology ? '负增长' : '负值'}</span>
      {showTrend && <span><i data-tone="trend" />正常幅度平滑趋势</span>}
      <small>幅度（绝对值）{outliers.size > 0 && ' · ○ 疑似离群 · 虚线：估计值'}</small>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.chart} role="group" aria-label={growthTerminology && valueLabel === '价敏用户净增' ? '每日价敏用户净增柱状图' : `${valueLabel}柱状图`}>
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
        if (isOutlier) return <circle key={`${labels[index]}-${index}`} cx={xFor(index)} cy={14} r={5} fill="none" stroke="var(--text-3)" strokeWidth="1.5" data-outlier="true" tabIndex={0} role="button" aria-label={`${labels[index]}，${valueLabel} ${Math.round(value)}`} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} onClick={() => setActiveIndex(index)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveIndex(index); } }}><title>{`${labels[index]} · 区间极端值 ${value.toLocaleString('zh-CN')} · 不参与主图刻度与拟合`}</title></circle>;
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
          aria-label={`${labels[index]}，${valueLabel} ${Math.round(value)}`}
          onMouseEnter={() => setActiveIndex(index)}
          onFocus={() => setActiveIndex(index)}
          onBlur={() => setActiveIndex(null)}
        />{value < 0 && <text x={xFor(index)} y={Math.max(18, valueY - 6)} textAnchor="middle" fill="#D05C50" pointerEvents="none">↓</text>}</g>;
      })}
      {showTrend && hasValues && trendPath && <path d={trendPath} fill="none" className={styles.barTrendCurve} style={{ animationDelay: '260ms' }} />}
      {showTrend && hasValues && estimatedPath && <path d={estimatedPath} data-estimated="true" fill="none" strokeDasharray="6 5" className={styles.barTrendCurve}><title>跨离群日的幅度估计，非实测值</title></path>}
    </svg>
    {!hasValues && <div className={styles.trendPending}><span>NO DATA</span><strong>暂无增量数据</strong><p>当前筛选范围没有连续的每日快照</p></div>}
    {activeIndex != null && activeX != null && activeValue != null && <div className={styles.chartTooltip} data-align={tooltipAlign} style={{ left: `${activeX / width * 100}%` }} role="status">
      <strong>{labels[activeIndex]}</strong>
      <span><i style={{ background: activeValue < 0 ? '#D05C50' : '#2F6FDB' }} /><b>{valueLabel}{outliers.has(activeIndex) ? ' · 疑似离群 / 区间极端值，已从主图分离（不代表数据错误）' : ''}</b><em>{`${activeValue > 0 ? '+' : ''}${Math.round(activeValue).toLocaleString('zh-CN')}`}</em></span>
    </div>}
  </div>;
}

export function DonutChart({ distribution, hidden, onToggle, centerLabel = '已有价敏指标用户', valueUnit = '人', colorScheme = 'sensitivity' }: { distribution: Array<{ label: string; value: number }>; hidden: Set<string>; onToggle: (label: string) => void; centerLabel?: string; valueUnit?: string; colorScheme?: 'sensitivity' | 'categorical' }) {
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  if (distribution.length === 0) return <Empty description="暂无分布数据" />;
  const allTotal = distribution.reduce((sum, item) => sum + item.value, 0);
  const activeItem = activeLabel ? distribution.find((item) => item.label === activeLabel) : undefined;
  const unit = valueUnit ? ` ${valueUnit}` : '';
  // 通用模板显式选择分类色盘，不改变线上价敏报表的未知分类颜色。
  const colorFor = (label: string, index: number) => colorScheme === 'categorical'
    ? chartColors[index % chartColors.length]
    : sensitivityColors[label] ?? '#8E8E93';
  const radius = 84;
  let consumed = 0;
  return <div className={styles.donutLayout}>
    <svg viewBox="0 0 260 260" role="img" aria-label="报表扇形分布图" onMouseLeave={() => setActiveLabel(null)}>
      <circle cx="130" cy="130" r={radius} fill="none" stroke="var(--wb-surface-hover)" strokeWidth="30" />
      <g transform="rotate(-90 130 130)">{distribution.filter((item) => item.value > 0).map((item, index) => {
        const isHidden = hidden.has(item.label);
        const start = consumed / allTotal;
        consumed += item.value;
        return <path key={item.label} d={buildDonutArcPath(start, consumed / allTotal)} fill="none" stroke={isHidden ? 'var(--report-donut-muted)' : colorFor(item.label, index)} strokeWidth="30" data-donut-sector data-state={isHidden ? 'disabled' : 'enabled'} className={`${styles.donutSegment} ${isHidden ? styles.donutSegmentMuted : ''} ${activeLabel === item.label ? styles.donutSegmentActive : ''}`} style={{ animationDelay: `${index * 90}ms` }} tabIndex={0} aria-label={`${item.label}: ${item.value.toLocaleString('zh-CN')}${unit}，${isHidden ? '已关闭' : '已显示'}`} onMouseEnter={() => setActiveLabel(item.label)} onFocus={() => setActiveLabel(item.label)} onBlur={() => setActiveLabel(null)} onClick={() => onToggle(item.label)} onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle(item.label);
          }
        }}><title>{`${item.label}: ${item.value.toLocaleString('zh-CN')}${unit} · ${allTotal ? Number((item.value / allTotal * 100).toFixed(1)) : 0}% · ${isHidden ? '已关闭' : '已显示'}`}</title></path>;
      })}</g>
      <text x="130" y="126" textAnchor="middle" className={styles.donutValue}>{compactCount(activeItem?.value ?? allTotal)}</text>
      <text x="130" y="149" textAnchor="middle" className={styles.donutLabel}>{activeItem ? `${activeItem.label}${hidden.has(activeItem.label) ? ' · 已关闭' : ''}` : centerLabel}</text>
    </svg>
    <div className={styles.donutLegend}>{distribution.map((item, index) => {
      const isHidden = hidden.has(item.label);
      return <button type="button" key={item.label} aria-pressed={!isHidden} data-state={isHidden ? 'disabled' : 'enabled'} className={`${isHidden ? styles.legendMuted : ''} ${activeLabel === item.label ? styles.donutLegendActive : ''}`} onMouseEnter={() => setActiveLabel(item.label)} onMouseLeave={() => setActiveLabel(null)} onFocus={() => setActiveLabel(item.label)} onBlur={() => setActiveLabel(null)} onClick={() => onToggle(item.label)}><i style={{ background: isHidden ? 'var(--report-donut-muted)' : colorFor(item.label, index) }} /><b>{item.label}</b><em>{item.value.toLocaleString('zh-CN')}{unit} · {allTotal ? Number((item.value / allTotal * 100).toFixed(1)) : 0}%</em></button>;
    })}</div>
  </div>;
}

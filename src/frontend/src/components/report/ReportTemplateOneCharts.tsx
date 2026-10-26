import { DonutChart, IncrementBarChart, SmoothChart } from './ReportCharts';

/** The V1.2 chart components are the visual source of truth for template-1. */
export const REPORT_TEMPLATE_ONE_VERSION = '1.0.0';

export function TemplateOneLineChart({ labels, series, pendingText = '当前查询没有可用数据' }: {
  labels: string[];
  series: Array<{ key?: string; label: string; values: number[] }>;
  pendingText?: string;
}) {
  return <SmoothChart labels={labels} series={series} height={270} trendRule="raw" pendingText={pendingText} />;
}

export function TemplateOneBarChart({ labels, values, valueLabel }: { labels: string[]; values: number[]; valueLabel: string }) {
  return <IncrementBarChart labels={labels} values={values} valueLabel={valueLabel} raw growthTerminology={false} showTrend={false} />;
}

export function TemplateOneDonutChart({ distribution, hidden, onToggle }: {
  distribution: Array<{ label: string; value: number }>;
  hidden: Set<string>;
  onToggle: (label: string) => void;
}) {
  return <DonutChart distribution={distribution} hidden={hidden} onToggle={onToggle} centerLabel="总量" valueUnit="" colorScheme="categorical" />;
}

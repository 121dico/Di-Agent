import type { ContextUsageStatus } from '@/types/context';

export function clampUsageRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  }
  return String(Math.max(0, Math.round(value)));
}

export function getUsageStatusLabel(status: ContextUsageStatus): string {
  switch (status) {
    case 'normal':
      return '正常';
    case 'warning':
      return '接近上限';
    case 'critical':
      return '建议迁移';
    default:
      return '暂无数据';
  }
}

import type { ReportDataSource } from '@/types/report';

export interface ReportSourceFolderGroup {
  key: string;
  name: string;
  label: string;
  sources: ReportDataSource[];
}

const UNGROUPED_KEY = '\u0000ungrouped';
const UNGROUPED_LABEL = '未分组';

export function groupReportSourcesByFolder(sources: ReportDataSource[]): ReportSourceFolderGroup[] {
  const groups = new Map<string, ReportSourceFolderGroup>();
  for (const source of sources) {
    const name = (source.folder ?? '').trim();
    const key = name === '' ? UNGROUPED_KEY : name;
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, name, label: name || UNGROUPED_LABEL, sources: [] };
      groups.set(key, group);
    }
    group.sources.push(source);
  }
  return Array.from(groups.values()).sort((left, right) => {
    const leftUngrouped = left.name === '';
    const rightUngrouped = right.name === '';
    if (leftUngrouped !== rightUngrouped) return leftUngrouped ? 1 : -1;
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
  });
}

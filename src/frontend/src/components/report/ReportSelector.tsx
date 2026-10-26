import { Select } from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
import type { ReportDefinition } from '@/types/report';
import styles from './ReportSelector.module.css';

interface ReportSelectorProps {
  reports: Pick<ReportDefinition, 'id' | 'name'>[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function ReportSelector({ reports, selectedId, onSelect }: ReportSelectorProps) {
  return (
    <div className={styles.directory}>
      <span className={styles.label}>报表目录</span>
      <Select
        className={styles.select}
        aria-label="报表目录"
        prefix={<BarChartOutlined />}
        value={selectedId || undefined}
        onChange={onSelect}
        showSearch={{ optionFilterProp: 'label' }}
        placeholder={reports.length ? '选择报表' : '暂无报表'}
        notFoundContent={reports.length ? '未找到匹配报表' : '暂无报表'}
        options={reports.map((report) => ({ value: report.id, label: report.name }))}
      />
    </div>
  );
}

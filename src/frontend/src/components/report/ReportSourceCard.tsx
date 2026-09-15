import { useEffect, useRef, useState, type FC } from 'react';
import { Button } from 'antd';
import { DatabaseOutlined, RightOutlined } from '@ant-design/icons';
import { getReportSourceTimeCoverage, refreshReportSourceTimeCoverage } from '@/api/report';
import type { ReportDataSource, ReportSourceTimeCoverage, ReportSourceTimeRange } from '@/types/report';
import styles from '@/views/ReportsView.module.css';

interface ReportSourceCardProps {
  source: ReportDataSource;
  onOpen: (id: string) => void;
  active?: boolean;
}

function rangeText(range: ReportSourceTimeRange): string {
  return range.empty ? '无可用日期' : `${range.start ?? '—'} → ${range.end ?? '—'}`;
}

function checkedTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false });
}

export const ReportSourceCard: FC<ReportSourceCardProps> = ({ source, onOpen, active = true }) => {
  const [coverage, setCoverage] = useState<ReportSourceTimeCoverage>();
  const [reading, setReading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);

  useEffect(() => {
    const request = ++epoch.current;
    if (!active) return;
    setCoverage(undefined);
    setReading(true);
    setChecking(false);
    setError('');
    // 目录打开只读持久元数据，不自动触发上游扫描。
    void getReportSourceTimeCoverage(source.id).then(result => {
      if (request === epoch.current) setCoverage(result);
    }).catch(() => {
      if (request === epoch.current) setError('读取可用时间失败，请重试核验');
    }).finally(() => {
      if (request === epoch.current) setReading(false);
    });
    return () => { ++epoch.current; };
  }, [source.id, active]);

  const verify = async () => {
    const request = ++epoch.current;
    setReading(false);
    setChecking(true);
    setError('');
    try {
      const result = await refreshReportSourceTimeCoverage(source.id);
      if (request === epoch.current) setCoverage(result);
    } catch {
      // 网络或服务故障不能抹掉上次成功范围，也不回显可能包含认证信息的原始错误。
      if (request === epoch.current) setError(coverage?.checked_at ? '核验失败，已保留上次结果，请稍后重试' : '核验失败，请稍后重试');
    } finally {
      if (request === epoch.current) setChecking(false);
    }
  };

  return <article className={styles.sourceCardShell}>
    <button type="button" className={styles.sourceCard} aria-label={`查看${source.name}详情`} onClick={() => onOpen(source.id)}>
      <span className={styles.sourceCardIcon}><DatabaseOutlined /></span>
      <span className={styles.sourceCardBody}>
        <strong>{source.name}</strong>
        <span className={styles.sourceDescription}>{source.description || '尚未添加中文用途说明'}</span>
        <span className={styles.sourceMeta}><code>{source.api_name}</code><em data-enabled={source.enabled}>{source.enabled ? '已启用' : '已停用'}</em></span>
      </span>
      <RightOutlined className={styles.sourceCardArrow} />
    </button>
    <div className={styles.sourceCoverage} aria-busy={reading || checking}>
      <div className={styles.sourceCoverageHead}><strong>API 可用时间</strong><Button size="small" loading={checking} disabled={reading} onClick={() => void verify()}>{checking ? '正在核验' : '核验可用时间'}</Button></div>
      <div role="status" aria-live="polite">
        {reading ? <p>正在读取已保存的时间…</p> : <>
          {coverage?.partition && <p>分区 {coverage.partition.field}：{rangeText(coverage.partition)}</p>}
          {coverage?.business && <p>业务 {coverage.business.field}：{rangeText(coverage.business)}{coverage.business.partition && <small>查询范围：dt = {coverage.business.partition}</small>}</p>}
          {(!coverage || coverage.status === 'unchecked') && !error && <p>尚未核验可用时间</p>}
          {coverage?.status === 'stale' && <p className={styles.sourceCoverageWarning}>配置已变更，当前显示为旧配置结果，请重新核验</p>}
          {coverage?.status === 'failed' && <p className={styles.sourceCoverageWarning}>{coverage.checked_at ? '最近核验失败，保留上次成功结果，请重试' : '最近核验失败，请重试'}</p>}
          {error && <p className={styles.sourceCoverageWarning}>{error}</p>}
          {coverage?.checked_at && <small>上次成功核验：{checkedTime(coverage.checked_at)}</small>}
          {coverage?.attempted_at && coverage.status === 'failed' && <small>最近尝试：{checkedTime(coverage.attempted_at)}</small>}
          {(coverage?.partition || coverage?.business) && <small>首末日期范围，不代表每日连续有数据</small>}
        </>}
      </div>
    </div>
  </article>;
};

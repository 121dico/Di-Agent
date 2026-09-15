// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReportDataSource } from '@/types/report';
import { ReportSourceCard } from './ReportSourceCard';
import { getReportSourceTimeCoverage, refreshReportSourceTimeCoverage } from '@/api/report';

vi.mock('@/api/report', () => ({ getReportSourceTimeCoverage: vi.fn(), refreshReportSourceTimeCoverage: vi.fn() }));
const source: ReportDataSource = { id: 'one', name: '订单源', description: '订单明细', api_name: 'orders', endpoint: '', app_key_env: '', signature_env: '', x_date_env: '', enabled: true, created_at: '' };
const host = document.createElement('div');
let root = createRoot(host);
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(host); vi.clearAllMocks(); });
it('only reads cached coverage on opening and keeps detail and verification buttons independent', async () => {
  vi.mocked(getReportSourceTimeCoverage).mockResolvedValue({ source_id: 'one', status: 'unchecked', continuous: false });
  const open = vi.fn();
  await act(async () => root.render(<ReportSourceCard source={source} onOpen={open} />));
  expect(host.textContent).toContain('尚未核验可用时间');
  expect(refreshReportSourceTimeCoverage).not.toHaveBeenCalled();
  expect(host.querySelector('button button')).toBeNull();
  await act(async () => (host.querySelector('[aria-label="查看订单源详情"]') as HTMLButtonElement).click());
  expect(open).toHaveBeenCalledWith('one');
});

it('shows persisted ranges, explicit loading, and retains the previous successful dates when verification fails', async () => {
  vi.mocked(getReportSourceTimeCoverage).mockResolvedValue({ source_id: 'one', status: 'verified', continuous: false, checked_at: '2026-09-15T08:00:00Z', partition: { field: 'dt', start: '2026-07-28', end: '2026-09-14', empty: false }, business: { field: 'order_date', start: '2022-01-18', end: '2026-09-14', partition: '2026-09-14', empty: false } });
  let reject!: (reason: Error) => void;
  vi.mocked(refreshReportSourceTimeCoverage).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  await act(async () => root.render(<ReportSourceCard source={source} onOpen={vi.fn()} />));
  expect(host.textContent).toContain('业务 order_date：2022-01-18 → 2026-09-14');
  expect(host.textContent).toContain('查询范围：dt = 2026-09-14');
  await act(async () => ([...host.querySelectorAll('button')].find(button => button.textContent === '核验可用时间')!).click());
  expect(host.textContent).toContain('正在核验');
  expect(host.textContent).toContain('2026-07-28 → 2026-09-14');
  await act(async () => reject(new Error('secret upstream response')));
  expect(host.textContent).toContain('核验失败，已保留上次结果');
  expect(host.textContent).toContain('上次成功核验：2026/9/15');
  expect(host.textContent).not.toContain('2026-09-15T08:00:00Z');
  expect(host.textContent).not.toContain('secret upstream');
});

it('shows stale configuration and empty dates distinctly, and reopens by reading metadata only', async () => {
  vi.mocked(getReportSourceTimeCoverage).mockResolvedValue({ source_id: 'one', status: 'stale', continuous: false, partition: { field: 'dt', start: null, end: null, empty: true } });
  await act(async () => root.render(<ReportSourceCard source={source} onOpen={vi.fn()} />));
  expect(host.textContent).toContain('配置已变更');
  expect(host.textContent).toContain('分区 dt：无可用日期');
  expect(host.textContent).toContain('不代表每日连续');
  await act(async () => root.render(null));
  await act(async () => root.render(<ReportSourceCard source={source} onOpen={vi.fn()} />));
  expect(getReportSourceTimeCoverage).toHaveBeenCalledTimes(2);
  expect(refreshReportSourceTimeCoverage).not.toHaveBeenCalled();
});

it('does not invent previous successful results for a first failed verification', async () => {
  vi.mocked(getReportSourceTimeCoverage).mockResolvedValue({ source_id: 'one', status: 'unchecked', continuous: false });
  vi.mocked(refreshReportSourceTimeCoverage).mockResolvedValue({ source_id: 'one', status: 'failed', continuous: false, attempted_at: '2026-09-15T08:00:00Z', error: 'upstream authentication details' });
  await act(async () => root.render(<ReportSourceCard source={source} onOpen={vi.fn()} />));
  await act(async () => ([...host.querySelectorAll('button')].find(button => button.textContent === '核验可用时间')!).click());
  expect(host.textContent).toContain('最近核验失败，请重试');
  expect(host.textContent).not.toContain('保留上次');
  expect(host.textContent).not.toContain('upstream authentication');
});

it('rereads metadata when the retained modal is reopened, and does not read while closed', async () => {
  vi.mocked(getReportSourceTimeCoverage).mockResolvedValue({ source_id: 'one', status: 'unchecked', continuous: false });
  await act(async () => root.render(<ReportSourceCard source={source} onOpen={vi.fn()} active={false} />));
  expect(getReportSourceTimeCoverage).not.toHaveBeenCalled();
  await act(async () => root.render(<ReportSourceCard source={source} onOpen={vi.fn()} active />));
  expect(getReportSourceTimeCoverage).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<ReportSourceCard source={source} onOpen={vi.fn()} active={false} />));
  await act(async () => root.render(<ReportSourceCard source={source} onOpen={vi.fn()} active />));
  expect(getReportSourceTimeCoverage).toHaveBeenCalledTimes(2);
  expect(refreshReportSourceTimeCoverage).not.toHaveBeenCalled();
});

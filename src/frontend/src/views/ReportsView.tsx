import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Form, Input, Modal, Select, Spin, Switch } from 'antd';
import {
  DownloadOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { message } from '@/utils/message';
import { useSearchParams } from 'react-router-dom';
import {
  createReport,
  downloadReportRun,
  listReportRuns,
  listReports,
  listReportSources,
  queryReportAnalytics,
  queryReportPage,
  queryReportSearch,
  runReport,
  updateReport,
} from '@/api/report';
import { useAuthStore } from '@/store/authStore';
import type { ReportAnalyticsRange, ReportAnalyticsResult, ReportDataSource, ReportDefinition, ReportPageResult, ReportRun, ReportVisualization } from '@/types/report';
import { buildPriceSensitiveAnalyticsPresentation, buildReportPresentation, filterAndSortReportRows, reportColumnsForGroup } from './reportPresentation';
import type { ReportFieldGroup, ReportSort } from './reportPresentation';
import { buildReportAccessPolicy } from './reportAccess';
import { PersonalReportsLibrary } from '@/components/personal-report/PersonalReportsLibrary';
import { usePersonalReportStore } from '@/store/personalReportStore';
import { ReportTemplateModal } from '@/components/report/ReportTemplateModal';
import { ReportProvenance } from '@/components/report/ReportProvenance';
import { ReportCohortSections } from '@/components/report/ReportCohortSections';
import { SmoothChart, IncrementBarChart, DonutChart, chartColors } from '@/components/report/ReportCharts';
import { StationValidation } from '@/components/report/StationValidation';
import { ReportLaneTrends } from '@/components/report/ReportLaneTrends';
import { loadStoredSnapshotHistory } from './reportSnapshotHistory';
import { expandChinaRegionSelection, summarizeChinaRegionSelection } from '@/components/report/ChinaRegionPicker';
import { ReportRegionFilter } from '@/components/report/ReportRegionFilter';
import { ReportAgentWidget } from '@/components/report/ReportAgentWidget';
import type { ReportAgentContext } from '@/components/report/reportAgentContext';
import { ReportSelector } from '@/components/report/ReportSelector';
import styles from './ReportsView.module.css';

const defaultQuery = JSON.stringify({ fieldList: [{ name: 'duid', alias: 'user_count', aggFunctionEnum: 'COUNT DISTINCT' }], conditionList: [], groupList: [], needPagination: false }, null, 2);
const defaultVisualization = JSON.stringify({ metrics: [{ field: 'user_count', label: '用户数', suffix: '人' }], chart: { xField: 'dt', series: [{ field: 'user_count', label: '用户数', color: '#F2802E' }] } }, null, 2);

interface ReportForm { name: string; description?: string; data_source_id: string; query: string; visualization: string; enabled: boolean }

const statusLabel: Record<ReportRun['status'], string> = { pending: '运行中', succeeded: '已完成', failed: '失败' };
const rangeOptions: Array<{ value: ReportAnalyticsRange; label: string }> = [
  { value: 'all', label: '全部 dt 历史' },
  { value: '1d', label: '近 1 天' },
  { value: '7d', label: '近 7 天' },
  { value: '31d', label: '近 31 天' },
  { value: '365d', label: '近 1 年' },
];
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

export { SmoothChart, IncrementBarChart, DonutChart } from '@/components/report/ReportCharts';
interface PublicReportsWorkspaceProps {
  visible: boolean;
  onAgentContext: (context: ReportAgentContext) => void;
}

const PublicReportsWorkspace: React.FC<PublicReportsWorkspaceProps> = ({ visible, onAgentContext }) => {
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
  const [reportOpen, setReportOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
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
  const [reportForm] = Form.useForm<ReportForm>();

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
  const agentCityKey = JSON.stringify(expandedAppliedCities);
  const agentSummary = analyticsLoading ? '统计加载中，暂不引用数值。' : analyticsError ? '当前统计加载失败，请查询真实数据后再分析。' : analytics ? JSON.stringify(analytics.summary) : '当前没有可用汇总，请先读取报表数据。';
  const agentDateRange = analyticsLoading ? selectedRangeLabel : analyticsDateRangeLabel;
  useEffect(() => {
    onAgentContext({
      reportId: selected?.id,
      reportName: selected?.name ?? '公共报表',
      dataDate: activePartition === '—' ? undefined : activePartition,
      dateRange: agentDateRange,
      cities: JSON.parse(agentCityKey) as string[],
      summary: agentSummary,
    });
  }, [onAgentContext, selected?.id, selected?.name, activePartition, agentDateRange, agentCityKey, agentSummary]);

  useEffect(() => {
    const root = pageRef.current;
    if (!root || !selected) return;
    const ids = ['report-overview', 'report-order-cohort', 'report-increments', 'report-trend'];
    if (isV12) ids.push('report-station-validation');
    ids.push('report-search');
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
  }, [selected, isV12, access.canBrowseFullDetail, access.canViewRunHistory]);

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

  // 地图多选合并为一次查询；旧请求由 analytics effect 的 active 标记隔离。
  const draftFilterKey = JSON.stringify([selectedId, draftCities, draftProvinceCodes, draftDashboardRange]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (expandChinaRegionSelection(draftCities, draftProvinceCodes).length > 50) return;
      setAppliedCities((current) => JSON.stringify(current) === JSON.stringify(draftCities) ? current : draftCities);
      setAppliedProvinceCodes((current) => JSON.stringify(current) === JSON.stringify(draftProvinceCodes) ? current : draftProvinceCodes);
      setAppliedDashboardRange(draftDashboardRange);
    }, 25);
    return () => window.clearTimeout(timer);
  }, [draftFilterKey]);

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
      message.success(isV12 ? '后台预计算已提交，完成后刷新报表查看' : '报表生成完成');
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
          <h1>数据报表</h1>
          <ReportSelector reports={reports} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className={styles.actions}>
          {access.canManageReports && <Button onClick={() => setTemplateOpen(true)}>套用模板</Button>}
          {access.canManageReports && isV12 && <Button disabled={!selected} onClick={() => setProvenanceOpen(true)}>图表数据逻辑</Button>}
          {access.canManageReports && <><Button icon={<PlusOutlined />} onClick={openCreateReport}>新建报表</Button><Button icon={<EditOutlined />} disabled={!selected} onClick={openEditReport}>编辑当前报表</Button><Button type="primary" icon={<PlayCircleOutlined />} loading={running} disabled={!selected} onClick={() => void handleRun()}>立即生成</Button></>}
        </div>
      </header>

      {access.canManageReports && isV12 && selected && <ReportProvenance reportId={selected.id} open={provenanceOpen} onClose={() => setProvenanceOpen(false)} executionIds={analytics?.execution_ids} startDate={analytics?.start_date} endDate={analytics?.end_date} dataDate={analytics?.data_date} />}

      <section className={styles.workspace}>
        <div className={`${styles.dashboard} ${isV12 ? styles.v12Dashboard : ''}`}>
          {selected ? <>
            <section className={styles.summaryHero}>
              <div>
                <span className={styles.eyebrow}>REPORT OVERVIEW · BUSINESS INSIGHT</span>
                <h2>{selected.name}</h2>
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
              {isV12 && <a className={activeSection === 'report-station-validation' ? styles.anchorActive : ''} href="#report-station-validation" onClick={() => setActiveSection('report-station-validation')}>数据验证</a>}
              <a className={activeSection === 'report-search' ? styles.anchorActive : ''} href="#report-search" onClick={() => setActiveSection('report-search')}>用户查询</a>
              {access.canBrowseFullDetail && <a className={activeSection === 'report-detail' ? styles.anchorActive : ''} href="#report-detail" onClick={() => setActiveSection('report-detail')}>数据明细</a>}
              {access.canViewRunHistory && <a className={activeSection === 'report-history' ? styles.anchorActive : ''} href="#report-history" onClick={() => setActiveSection('report-history')}>运行记录</a>}
            </nav>

            <ReportRegionFilter cities={draftCities} provinces={draftProvinceCodes} onCities={setDraftCities} onProvinces={setDraftProvinceCodes} onReset={resetDashboardFilters} />

            {isV12 ? <ReportCohortSections key={selectedId} reportId={selectedId} cities={expandedAppliedCities} analytics={analytics} loading={analyticsLoading} error={analyticsError}
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
            {isV12 && <StationValidation key={`validation-${selectedId}`} reportId={selectedId} isAdmin={isAdmin} renderChart={(labels, series) => <SmoothChart labels={labels} series={series} height={270} pendingText="暂无有效数据，或图例已全部关闭" />} />}
            <section className={`${styles.summaryBlock} ${styles.fullWidthBlock}`} id="report-search">
              <div className={styles.blockHead}><div><span>{isV12 ? '06' : '03'}</span><strong>用户查询</strong></div><small>输入完整 DUID · 仅返回精确匹配结果</small></div>
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
              <div className={styles.blockHead}><div><span>{isV12 ? '07' : '04'}</span><strong>数据明细</strong></div><small>全量数据 · 服务端分页 · 共 {totalRows.toLocaleString('zh-CN')} 行</small></div>
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
              <div className={styles.blockHead}><div><span>{isV12 ? '08' : '05'}</span><strong>运行记录</strong></div></div>
              <div className={styles.card}>
                <div className={styles.runList}>{runs.map((run) => <div key={run.id} className={styles.runRow}><span className={`${styles.statusDot} ${styles[run.status]}`} /><strong>{statusLabel[run.status]}</strong><span>{run.trigger === 'scheduled' ? '每日 10:00' : '手动生成'}</span><span>{new Date(run.started_at).toLocaleString('zh-CN', { hour12: false })}</span><span>{run.source_partition || run.error_message || '—'}</span></div>)}{runs.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有运行记录" />}</div>
              </div>
            </section>}
          </> : <div className={styles.emptyCard}><Empty description="先创建一份报表" /></div>}
        </div>
      </section>

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
  const [searchParams] = useSearchParams();
  const personalReportId = searchParams.get('personalReport');
  const openLibraryReport = usePersonalReportStore((state) => state.openLibraryReport);
  const [workspace, setWorkspace] = useState<'public' | 'personal'>(personalReportId ? 'personal' : 'public');
  const [publicVisited, setPublicVisited] = useState(!personalReportId);
  const [personalVisited, setPersonalVisited] = useState(Boolean(personalReportId));
  const [agentContext, setAgentContext] = useState<ReportAgentContext>({ reportName: '公共报表', cities: [] });

  useEffect(() => {
    if (!personalReportId) return;
    setWorkspace('personal');
    setPersonalVisited(true);
    void openLibraryReport(personalReportId);
  }, [personalReportId, openLibraryReport]);

  const selectWorkspace = (next: 'public' | 'personal') => {
    if (next === 'personal') setPersonalVisited(true);
    else setPublicVisited(true);
    setWorkspace(next);
  };

  return (
    <div className={styles.reportHub}>
      <nav className={styles.reportHubTabs} aria-label="报表中心">
        <button type="button" aria-current={workspace === 'public' ? 'page' : undefined} onClick={() => selectWorkspace('public')}>公共报表</button>
        <button type="button" aria-current={workspace === 'personal' ? 'page' : undefined} onClick={() => selectWorkspace('personal')}>我的报表</button>
      </nav>
      {publicVisited && <div className={workspace === 'public' ? styles.reportHubPane : styles.reportHubPaneHidden}>
        <PublicReportsWorkspace visible={workspace === 'public'} onAgentContext={setAgentContext} />
      </div>}
      <ReportAgentWidget context={workspace === 'public' ? agentContext : { reportName: '我的报表', cities: [] }} />
      {personalVisited && (
        <div className={workspace === 'personal' ? styles.reportHubPane : styles.reportHubPaneHidden}>
          <PersonalReportsLibrary />
        </div>
      )}
    </div>
  );
};

export default ReportsView;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, Modal, Spin, Table, Tag } from 'antd';
import { ApiOutlined, CloudServerOutlined, DatabaseOutlined, ExportOutlined, HistoryOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { message } from '@/utils/message';
import DataSourceManagerModal from '@/components/report/DataSourceManagerModal';
import DatadreamSetupPanel, { type DataConnectionState, type DataConnectionStatus } from '@/components/knowledge/DatadreamSetupPanel';
import { useAuthStore } from '@/store/authStore';
import { addHiveTable, getDataSession, getHiveReceipt, listAPISourceStatuses, listDataConnections, listHiveCatalog, listHiveReceipts, listHiveTables, loginHive, runHiveQuery, type APIConnectionStatus, type DataConnection, type DataSessionIdentity, type HiveCatalogSnapshot, type HiveReceipt, type HiveTable } from '@/api/dataHub';
import styles from './KnowledgeView.module.css';

const connectionIcons: Record<DataConnection['kind'], React.ReactNode> = {
  api: <ApiOutlined />, hive: <DatabaseOutlined />, datamap: <CloudServerOutlined />, cooper: <CloudServerOutlined />,
};
const pendingConnections: DataConnection[] = [
  { kind: 'api', name: 'API 接口', account: '', status: '检测中', detail: '正在读取连接状态' },
  { kind: 'cooper', name: 'Cooper', account: '', status: '检测中', detail: '正在读取连接状态' },
];
const dataConnectionStatusNames: Record<DataConnectionStatus, string> = {
  unknown: '尚未验证', checking: '检测中', connected: 'MCP 已验证', failed: '连接未通过', offline: '电脑离线',
};

function isConnectedForDisplay(connection: DataConnection): boolean {
  return connection.status === '已连接' || (connection.kind === 'api' && connection.status === '已登记');
}

function defaultSQL(tableName: string): string {
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  return `SELECT COUNT(*) AS row_count\nFROM ${tableName}\nWHERE dt = '${yesterday}'`;
}

const KnowledgeView: React.FC = () => {
  const userId = useAuthStore((state) => state.user?.id);
  const [dataConnectionState, setDataConnectionState] = useState<DataConnectionState | null>(null);
  const dataConnectionStatus = dataConnectionState?.userId === userId ? dataConnectionState?.status ?? 'unknown' : 'unknown';
  const [connections, setConnections] = useState<DataConnection[]>(pendingConnections);
  const [session, setSession] = useState<DataSessionIdentity | null>(null);
  const [tables, setTables] = useState<HiveTable[]>([]);
  const [apiSources, setAPISources] = useState<APIConnectionStatus[]>([]);
  const [receipts, setReceipts] = useState<HiveReceipt[]>([]);
  const [activeKind, setActiveKind] = useState<DataConnection['kind'] | 'datadream'>('datadream');
  const [activeTable, setActiveTable] = useState('');
  const [sql, setSQL] = useState('');
  const [result, setResult] = useState<HiveReceipt | null>(null);
  const [search, setSearch] = useState('');
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [receiptsLoading, setReceiptsLoading] = useState(true);
  const [tablesError, setTablesError] = useState('');
  const [catalog, setCatalog] = useState<HiveCatalogSnapshot | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogSearchDraft, setCatalogSearchDraft] = useState('');
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [recentTables, setRecentTables] = useState<string[]>([]);
  const [addingTable, setAddingTable] = useState('');
  const [running, setRunning] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [hiveUsername, setHiveUsername] = useState('');
  const [hivePassword, setHivePassword] = useState('');
  const [hiveLoginOpen, setHiveLoginOpen] = useState(false);
  const [hiveLoginError, setHiveLoginError] = useState('');
  const [authenticating, setAuthenticating] = useState(false);
  const [addTableError, setAddTableError] = useState('');
  const refreshEpoch = useRef(0);
  const tableRequestEpoch = useRef(0);

  const refresh = useCallback(() => {
    const epoch = ++refreshEpoch.current;
    setCatalogVersion((value) => value + 1);
    setConnectionLoading(true);
    setTablesLoading(true);
    const tableEpoch = ++tableRequestEpoch.current;
    setReceiptsLoading(true);
    setTablesError('');
    setLoadError('');
    void getDataSession().then((identity) => { if (epoch === refreshEpoch.current) setSession(identity); }).catch(() => {});
    void listDataConnections().then((nextConnections) => {
      if (epoch !== refreshEpoch.current) return;
      setConnections(nextConnections);
      const hiveAccount = nextConnections.find((connection) => connection.kind === 'hive')?.account;
      if (hiveAccount) setHiveUsername((current) => current || hiveAccount);
    }).catch((error) => {
      if (epoch === refreshEpoch.current) setLoadError(error instanceof Error ? error.message : '加载数据连接失败');
    }).finally(() => { if (epoch === refreshEpoch.current) setConnectionLoading(false); });
    void listHiveTables().then((nextTables) => {
      if (epoch === refreshEpoch.current && tableEpoch === tableRequestEpoch.current) setTables(nextTables);
    }).catch((error) => {
      if (epoch === refreshEpoch.current && tableEpoch === tableRequestEpoch.current) setTablesError(error instanceof Error ? error.message : '表权限检测失败');
    }).finally(() => { if (epoch === refreshEpoch.current && tableEpoch === tableRequestEpoch.current) setTablesLoading(false); });
    void listHiveReceipts().then((nextReceipts) => {
      if (epoch === refreshEpoch.current) setReceipts(nextReceipts);
    }).catch(() => {}).finally(() => { if (epoch === refreshEpoch.current) setReceiptsLoading(false); });
    void listAPISourceStatuses().then((nextSources) => {
      if (epoch === refreshEpoch.current) setAPISources(nextSources);
    }).catch(() => {});
  }, []);

  useEffect(() => { refresh(); return () => { refreshEpoch.current++; }; }, [refresh]);
  useEffect(() => {
    if (!session?.user_id) return;
    try {
      const stored = JSON.parse(localStorage.getItem(`di-agent:hive-recent:${session.user_id}`) || '[]');
      if (Array.isArray(stored)) setRecentTables(stored.filter((name): name is string => typeof name === 'string').slice(0, 20));
    } catch { setRecentTables([]); }
  }, [session?.user_id]);
  useEffect(() => {
    if (activeKind !== 'hive' || !catalogSearch) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await listHiveCatalog(catalogSearch.trim(), recentTables);
        if (cancelled) return;
        setCatalog(next); setCatalogError('');
        if (next.state === 'scanning') timer = setTimeout(() => void load(), 3000);
      } catch (error) {
        if (!cancelled) setCatalogError(error instanceof Error ? error.message : 'Hive 目录读取失败');
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [activeKind, catalogSearch, catalogVersion, recentTables]);
  const filteredConnections = useMemo(() => connections.filter((connection) =>
    (connection.kind === 'api' || connection.kind === 'cooper') &&
    `${connection.name} ${connection.account}`.toLowerCase().includes(search.trim().toLowerCase())), [connections, search]);
  const showDataConnection = '数据连接 配置与连接诊断'.includes(search.trim().toLowerCase());
  const activeConnection = connections.find((connection) => connection.kind === activeKind);

  const selectTable = (tableName: string) => {
    setActiveKind('hive'); setActiveTable(tableName); setSQL(defaultSQL(tableName)); setResult(null);
  };

  const searchCatalog = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const term = catalogSearchDraft.trim().toLowerCase();
    if (!term) { setCatalogSearch(''); setCatalog(null); setCatalogError(''); setAddTableError(''); return; }
    if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(term)) {
      message.warning('请输入表名关键词，或完整的 库名.表名');
      return;
    }
    const scoped = term.includes('.') ? term : `epower_platform.${term}`;
    setCatalog(null); setCatalogError(''); setAddTableError(''); setCatalogSearch(scoped); setCatalogVersion((value) => value + 1);
  };

  const handleHiveLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hiveUsername.trim() || !hivePassword) { setHiveLoginError('请输入 Hadoop 账号和密码'); return; }
    setHiveLoginError('');
    setAuthenticating(true);
    try {
      await loginHive(hiveUsername.trim(), hivePassword);
      setActiveTable(''); setSQL(''); setResult(null);
      setTables([]);
      setConnections(pendingConnections);
      refresh();
      setCatalog(null); setCatalogError('');
      setHiveLoginOpen(false);
      message.success('Hadoop 已连接，正在重新检测表权限');
    } catch (error) { setHiveLoginError(error instanceof Error ? error.message : 'Hadoop 登录失败'); }
    finally { setHivePassword(''); setAuthenticating(false); }
  };

  const closeHiveLogin = () => {
    if (authenticating) return;
    setHiveLoginOpen(false);
    setHivePassword('');
    setHiveLoginError('');
  };

  const execute = async () => {
    if (!activeTable || !sql.trim()) { message.warning('请选择表并输入 SQL'); return; }
    setRunning(true);
    try {
      const next = await runHiveQuery(activeTable, sql);
      setResult(next);
      setReceipts((previous) => [next, ...previous].slice(0, 50));
      message.success('查询完成，结果已保存');
    } catch (error) { message.error(error instanceof Error ? error.message : 'Hive 查询失败'); }
    finally { setRunning(false); }
  };

  const openReceipt = async (id: string) => {
    try {
      const saved = await getHiveReceipt(id);
      setActiveKind('hive'); setActiveTable(saved.table_name); setSQL(saved.sql); setResult(saved);
    } catch { message.error('读取查询记录失败'); }
  };

  const selectedTable = tables.find((table) => table.name === activeTable);
  const readableTableCount = tables.filter((table) => table.query_enabled).length;
  const addedNames = useMemo(() => new Set(tables.map((table) => table.name)), [tables]);
  const addCandidate = async (name: string) => {
    if (addingTable) return;
    setAddTableError('');
    setAddingTable(name);
    try {
      const added = await addHiveTable(name);
      const tableEpoch = ++tableRequestEpoch.current;
      setTables((current) => current.some((table) => table.name === name) ? current : [...current, added]);
      const nextRecent = [name, ...recentTables.filter((item) => item !== name)].slice(0, 20);
      setRecentTables(nextRecent);
      if (session?.user_id) localStorage.setItem(`di-agent:hive-recent:${session.user_id}`, JSON.stringify(nextRecent));
      message.success(added.query_enabled ? '验证通过，已添加到可查询表' : '验证通过，已添加到个人表目录');
      try {
        const nextTables = await listHiveTables();
        if (tableEpoch === tableRequestEpoch.current) setTables(nextTables);
      } catch { message.warning('已添加，但列表刷新失败；重新打开页面可查看'); }
    } catch (error) { setAddTableError(`${name}：${error instanceof Error ? error.message : '读取权限未通过，未添加'}`); }
    finally { setAddingTable(''); }
  };
  const columns = result?.rows?.[0]
    ? Object.keys(result.rows[0]).map((key) => ({ title: key, dataIndex: key, key,
      render: (value: unknown) => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value) }))
    : [];

  return <div className={styles.hub}>
    <aside className={styles.sidebar}>
      <div className={styles.sidebarHeader}><strong>数据</strong><Button type="text" icon={<ReloadOutlined />} aria-label="刷新连接状态" onClick={refresh} /></div>
      <div className={styles.search}><Input prefix={<SearchOutlined />} placeholder="搜索数据连接" value={search} onChange={(event) => setSearch(event.target.value)} allowClear /></div>
      <div className={styles.sidebarScroll}>
        <div className={styles.sectionHeading}>数据连接 <span>{filteredConnections.length + Number(showDataConnection)}</span></div>
        {showDataConnection && <button type="button" className={`${styles.connection} ${activeKind === 'datadream' ? styles.connectionActive : ''}`}
          onClick={() => { setActiveKind('datadream'); closeHiveLogin(); }}>
          <span className={styles.connectionIcon}><CloudServerOutlined /></span><span className={styles.connectionText}><b>数据连接</b><small>配置与连接诊断</small></span>
          <span aria-label="数据连接状态" title={dataConnectionStatusNames[dataConnectionStatus]} className={`${styles.statusDot} ${dataConnectionStatus === 'connected' ? styles.statusConnected : dataConnectionStatus === 'checking' ? styles.statusChecking : dataConnectionStatus === 'failed' ? styles.statusFailed : ''}`} />
        </button>}
        {filteredConnections.map((connection) =>
          <button key={connection.kind} type="button" className={`${styles.connection} ${activeKind === connection.kind ? styles.connectionActive : ''}`}
            onClick={() => { setActiveKind(connection.kind); setResult(null); closeHiveLogin(); }}>
            <span className={styles.connectionIcon}>{connectionIcons[connection.kind]}</span>
            <span className={styles.connectionText}><b>{connection.name}</b><small>{connection.account || '未登录账号'}</small></span>
            <span className={`${styles.statusDot} ${connectionLoading && connection.status === '检测中' ? styles.statusChecking : isConnectedForDisplay(connection) ? styles.statusConnected : connection.status === '连接失败' ? styles.statusFailed : ''}`} title={connection.status} />
          </button>)}
      </div>
    </aside>
    <main className={styles.main}>
      <div hidden={activeKind !== 'datadream'}><DatadreamSetupPanel key={userId ?? 'signed-out'} onConnectionStateChange={setDataConnectionState} /></div>
      {activeKind !== 'datadream' && <>
      <div className={styles.pageHeader}><div><h1>{activeConnection?.name ?? '数据连接'}</h1><p>查看账号、连接状态和已保存的真实查询结果</p>{session && <p className={styles.sessionLine}>当前登录：{session.provider} · {session.account || '未知账号'} <span title={`Di Agent 用户 ID：${session.user_id}`}>ⓘ</span></p>}</div><div className={styles.headerActions}><Button icon={<ReloadOutlined />} onClick={refresh} loading={connectionLoading}>检查连接</Button>{activeKind === 'hive' && <Button type="primary" aria-label={activeConnection?.status === '已连接' ? '切换 Hadoop 账号' : 'Hadoop 登录'} onClick={() => { setHiveLoginError(''); setHiveLoginOpen(true); }}>{activeConnection?.status === '已连接' ? '切换账号' : '登录'}</Button>}</div></div>
      {loadError && <section className={styles.section}><Empty description={loadError} /><div className={styles.retry}><Button onClick={refresh}>重试</Button></div></section>}
      {activeConnection && <div className={styles.statusCard} aria-live="polite">
        <div><span className={styles.metaLabel}>登录账号</span><strong>{activeConnection.account || '未登录'}</strong></div>
        <div><span className={styles.metaLabel}>连接状态</span><Tag color={isConnectedForDisplay(activeConnection) ? 'green' : activeConnection.status === '连接失败' ? 'red' : 'default'}>{activeConnection.status === '检测中' ? <><Spin size="small" /> 检测中</> : activeConnection.status}</Tag></div>
        <div><span className={styles.metaLabel}>说明</span><span>{activeConnection.detail}</span></div>
      </div>}
      {activeKind === 'api' && <section className={styles.section}>
        <div className={styles.sectionTitle}><h2>API 数据源</h2><span>已登记 {activeConnection?.source_count ?? 0} 个</span></div>
        <p>每个 API 使用独立的服务端凭据。此处显示脱敏账号和配置状态；实际连通性在查询时验证。</p>
        {apiSources.length > 0 && <div className={styles.apiList}>{apiSources.map((source) => <div className={styles.apiSource} key={source.id}>
          <div><b>{source.name}</b><small>{source.account}</small></div>
          <div><Tag color={source.status === '凭据已配置' ? 'green' : 'default'}>{source.status}</Tag><small>{source.detail}</small></div>
        </div>)}</div>}
        <Button type="primary" disabled={activeConnection?.status === '需管理员权限'} onClick={() => setSourcesOpen(true)}>查看和管理 API 数据源</Button>
      </section>}
      {activeKind === 'hive' && <>
        <section className={`${styles.section} ${styles.hiveLoginSummary}`} aria-live="polite">
          <div className={styles.hiveLoginSummaryText}><h2>Hadoop 账号</h2><span>{activeConnection?.status === '已连接' ? `当前账号：${activeConnection.account}` : '登录后可查找和查询有权限的 Hive 表'}</span></div>
          <Tag color={activeConnection?.status === '已连接' ? 'green' : 'default'}>{activeConnection?.status === '已连接' ? '已登录' : activeConnection?.status === '检测中' ? '检测中' : '未登录'}</Tag>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><h2>查找并添加 Hive 表</h2><span>当前 Hadoop 账号</span></div>
          <p className={styles.tableScope}>输入完整的“库名.表名”，或输入表名关键词（默认在 epower_platform 查找）。搜索结果只是目录候选，点击“验证并添加”后才会检查读取权限。</p>
          <form className={styles.catalogSearchForm} onSubmit={searchCatalog}>
            <Input className={styles.catalogSearch} prefix={<SearchOutlined />} placeholder="例如 price_sensitive 或 epower_platform.price_sensitive_v1_3" value={catalogSearchDraft} onChange={(event) => setCatalogSearchDraft(event.target.value)} allowClear aria-label="搜索 Hive 库表" disabled={activeConnection?.status !== '已连接'} />
            <Button htmlType="submit" disabled={activeConnection?.status !== '已连接'}>查找表</Button>
            {/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(catalogSearchDraft.trim()) && <Button htmlType="button" loading={addingTable === catalogSearchDraft.trim().toLowerCase()} disabled={activeConnection?.status !== '已连接' || Boolean(addingTable) || addedNames.has(catalogSearchDraft.trim().toLowerCase())} onClick={() => void addCandidate(catalogSearchDraft.trim().toLowerCase())}>{addedNames.has(catalogSearchDraft.trim().toLowerCase()) ? '已添加' : '直接验证并添加'}</Button>}
          </form>
          {addTableError && <div className={styles.inlineError} role="alert">{addTableError}</div>}
          {catalogSearch && <div className={styles.catalogProgress} role="status" aria-live="polite">
            {catalog?.state === 'scanning' && <Spin size="small" />}
            {catalog ? <>找到 {catalog.discovered_tables} 张候选表{catalog.state === 'complete' && ' · 可选择验证'}{catalog.failed_databases > 0 && ` · ${catalog.failed_databases} 个库读取失败`}</> : '正在查找表名…'}
          </div>}
          {catalog?.notice && <p className={styles.catalogMore}>{catalog.notice}</p>}
          {catalogError && activeConnection?.status === '已连接' && <div className={styles.inlineError}>{catalogError} <Button size="small" onClick={() => setCatalogVersion((value) => value + 1)}>重试</Button></div>}
          {catalog?.error && <div className={styles.inlineError}>{catalog.error} <Button size="small" onClick={() => setCatalogVersion((value) => value + 1)}>重试</Button></div>}
          {catalog?.tables.length ? <div className={styles.tableList}>{catalog.tables.map((table) => <div key={table.name} className={`${styles.tableItem} ${styles.candidateRow}`}>
            <DatabaseOutlined />
            <span className={styles.tableCopy}><span className={styles.tableLabel}>{table.name}</span><small>仅匹配表名，尚未验证读取权限</small></span>
            <Button size="small" loading={addingTable === table.name} disabled={Boolean(addingTable) || addedNames.has(table.name)} onClick={() => void addCandidate(table.name)}>{addedNames.has(table.name) ? '已添加' : '验证并添加'}</Button>
          </div>)}</div> : catalog?.state === 'scanning' ? <div className={styles.inlineLoading}>正在查找匹配的表名…</div> : activeConnection?.status === '已连接' ? <Empty description={catalogSearch ? '没有匹配的表；请检查库名或缩短关键词' : '输入表名后点击“查找表”'} image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <Empty description="连接 Hadoop 后可查找并添加表" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          {catalog?.has_more && <p className={styles.catalogMore}>这里只显示排序靠前的 100 张表，输入库名或表名可查找其他结果。</p>}
        </section>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><h2>我的 Hive 表</h2><span>{tablesLoading ? '加载中' : `${tables.length} 张 · ${readableTableCount} 张可查询`}</span></div>
          <p className={styles.tableScope}>包含原有预设表和你添加的表。仅已验证可读取 dt 字段的表可以在下方运行 SQL；每次查询仍由 Hive 实时鉴权。</p>
          {tablesLoading ? <div className={styles.inlineLoading}><Spin size="small" /><span>正在用当前 Hadoop 账号验证表的读取权限…</span></div> : tablesError && activeConnection?.status === '已连接'
            ? <div className={styles.inlineError}>{tablesError} <Button size="small" onClick={refresh}>重试</Button></div> : tables.length === 0
            ? <Empty description={activeConnection?.status === '已连接' ? '暂无可查询的 Hive 表' : '连接后显示可查询的 Hive 表'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            : <div className={styles.tableList}>{tables.map((table) => <button key={table.name} type="button"
              className={`${styles.tableItem} ${activeTable === table.name ? styles.tableActive : ''}`}
              aria-pressed={activeTable === table.name} disabled={!table.query_enabled}
              onClick={() => selectTable(table.name)} title={`${table.description}；${table.permission_detail}`}>
              <DatabaseOutlined />
              <span className={styles.tableCopy}><span className={styles.tableLabel}>{table.name}</span><small>{table.permission_detail}</small></span>
              <Tag className={styles.permissionTag} color={table.query_enabled ? 'green' : 'default'}>{table.query_enabled ? '可查询' : '仅目录'}</Tag>
            </button>)}</div>}
        </section>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><h2>Hive SQL 查询</h2><span>仅查询已验证并添加的表</span></div>
          {activeTable ? <>
            <div className={styles.tableName}>{activeTable}</div>
            <Input.TextArea className={styles.sqlEditor} value={sql} onChange={(event) => setSQL(event.target.value)} rows={8} spellCheck={false} aria-label="Hive SQL" />
            <div className={styles.editorFooter}><span>只读查询 · 最多保存 10,000 行或 8 MB · 需指定 dt 分区</span><Button type="primary" loading={running} disabled={activeConnection?.status !== '已连接' || !selectedTable?.query_enabled} onClick={() => void execute()}>运行并保存</Button></div>
          </> : <Empty description="从上方选择一张 Hive 表开始查询" />}
        </section>
        {result && <section className={styles.section}>
          <div className={styles.sectionTitle}><h2>查询结果</h2><Tag color="green">已保存</Tag></div>
          <div className={styles.resultMeta}>记录 {result.id} · {result.row_count} 行 · {result.duration_ms} ms · {new Date(result.created_at).toLocaleString('zh-CN')}</div>
          <Table size="small" rowKey={(_, index) => String(index)} columns={columns} dataSource={result.rows ?? []} pagination={{ pageSize: 20, showSizeChanger: true }} scroll={{ x: 'max-content' }} />
        </section>}
        <section className={styles.section}>
          <div className={styles.sectionTitle}><h2><HistoryOutlined /> 已保存的查询</h2><span>{receipts.length} 条</span></div>
          {receiptsLoading && receipts.length === 0 ? <div className={styles.inlineLoading}><Spin size="small" /><span>正在加载查询记录…</span></div> : receipts.length === 0 ? <Empty description="暂无查询记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : <div className={styles.receiptList}>
            {receipts.map((receipt) => <button type="button" key={receipt.id} className={styles.receipt} onClick={() => void openReceipt(receipt.id)}>
              <span><b>{receipt.table_name}</b><small>{receipt.sql.replace(/\s+/g, ' ').slice(0, 110)}</small></span>
              <span>{receipt.row_count} 行<br />{new Date(receipt.created_at).toLocaleString('zh-CN')}</span>
            </button>)}
          </div>}
        </section>
      </>}
      {activeKind === 'datamap' && <>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><h2>数据地图网页登录</h2><span>企业 SSO</span></div>
          <p>数据地图使用企业账号在官网登录。点击后在新标签页完成登录，可直接查看你有权限访问的表与元数据。</p>
          <div className={styles.loginFooter}>
            <span>网页登录状态与 Di Agent 服务端连接分别验证。</span>
            <Button type="primary" icon={<ExportOutlined />} href="https://datamap.didichuxing.com/" target="_blank" rel="noopener noreferrer">打开数据地图</Button>
          </div>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionTitle}><h2>Agent 开放 API 接入</h2><Tag>待平台授权</Tag></div>
          <p>Agent 直接检索数据地图需要平台分配的 client 和 token；Hadoop 账号密码不能代替这组开放 API 凭证。当前未获授权，连接状态保持未接入。</p>
          <div className={styles.loginFields}>
            <label>Client<Input disabled placeholder="待数据地图平台分配" aria-label="数据地图 Client" /></label>
            <label>Token<Input.Password disabled placeholder="待数据地图平台分配" aria-label="数据地图 Token" /></label>
          </div>
          <div className={styles.loginFooter}>
            <span>凭证开通后，才可在这里连接并实时验证 Agent 访问。</span>
            <Button href="https://cooper.didichuxing.com/docs/document/2199281371619" target="_blank" rel="noopener noreferrer">查看开放 API 文档</Button>
          </div>
        </section>
      </>}
      {activeKind === 'cooper' && <section className={styles.section}>
        <div className={styles.sectionTitle}><h2>Cooper 接入</h2><Tag>未接入</Tag></div>
        <p>这里将展示该系统的登录账号、可访问的数据和服务端连接结果。当前没有可用的服务端认证配置，因此不会将浏览器登录状态显示为已连接。</p>
      </section>}
      </>}
    </main>
    <Modal title="Hadoop 账号登录" open={hiveLoginOpen} onCancel={closeHiveLogin} footer={null} width={640} destroyOnHidden mask={{ closable: !authenticating }} closable={!authenticating}>
      <form className={styles.loginForm} autoComplete="off" onSubmit={(event) => void handleHiveLogin(event)}>
        <div className={styles.loginFields}>
          <label>Hadoop 账号<Input value={hiveUsername} onChange={(event) => setHiveUsername(event.target.value)} autoComplete="username" placeholder="输入账号" aria-label="Hadoop 账号" autoFocus={!hiveUsername} /></label>
          <label>密码<Input.Password value={hivePassword} onChange={(event) => setHivePassword(event.target.value)} autoComplete="current-password" placeholder="输入密码" aria-label="Hadoop 密码" autoFocus={Boolean(hiveUsername)} /></label>
        </div>
        {hiveLoginError && <div className={styles.inlineError} role="alert">{hiveLoginError}</div>}
        <div className={styles.loginFooter}><span>新账号验证成功后才切换连接，并重新检测表权限。</span><Button type="primary" htmlType="submit" loading={authenticating}>连接并检测权限</Button></div>
      </form>
    </Modal>
    <DataSourceManagerModal open={sourcesOpen} onClose={() => { setSourcesOpen(false); refresh(); }} />
  </div>;
};

export default KnowledgeView;

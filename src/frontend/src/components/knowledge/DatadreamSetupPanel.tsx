import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Spin } from 'antd';
import { Link } from 'react-router-dom';
import { CheckCircleOutlined, ExclamationCircleOutlined, ExportOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useAuthStore } from '@/store/authStore';
import { inspectManagedMcp, listManagedMcpMachines, type ManagedMcpInspection, type ManagedMcpCheck } from '@/api/managedMcp';
import DatadreamConfigurationModal from './DatadreamConfigurationModal';
import type { DaemonMachine } from '@/types/agent';
import { computerDisplayName } from '@/utils/computerNames';
import { useBrowserMachine } from '@/hooks/useBrowserMachine';
import styles from './DatadreamSetupPanel.module.css';

const links = {
  key: 'https://mcphub.intra.xiaojukeji.com/square?action=open_tokens',
  safety: 'https://lca.xiaojukeji.com/',
  identity: 'https://cooper.didichuxing.com/knowledge/share/page/uRaZEPYXmPfm',
  project: 'https://cooper.didichuxing.com/knowledge/2199579337142/2207638044119',
  studio: 'https://studio.data.didichuxing.com/',
};
const checkNames: Record<ManagedMcpCheck['id'], string> = {
  daemon: '电脑连接程序', proxy: '本机 MCP 代理', identity: '安全身份与 MCP', credential: '个人 API Key', project: '数据项目',
};
const checkDetails: Record<string, string> = {
  daemon_ready: '连接程序支持数据连接配置和诊断。',
  proxy_reachable: '本机代理可访问；端口在线不代表身份已登录。',
  proxy_unreachable: '无法访问本机代理。请安装并启动滴滴安全助手，检查智能体安全设置。',
  identity_verified: '已完成真实 MCP 握手并读取工具目录。',
  identity_required: '身份校验未通过。请登录滴滴安全助手，检查新版 API Key 后重试。',
  mcp_failed: 'MCP 握手未通过。请检查公司网络、安全助手登录及 Key 配置。',
  key_present: '已找到本机个人凭据，不显示或上传原值。',
  key_missing: '还没有可用的个人 API Key，请在基础配置设置中填写。',
  project_unverified: '项目权限尚未验证；实际读取表或执行 SQL 时仍会实时鉴权。',
  configuration_changed: '配置已更改，之前的验证已失效，请重新检查。',
  timeout: '检测超时，请检查网络后重试。',
};
const checks: ManagedMcpCheck['id'][] = ['daemon', 'proxy', 'identity', 'credential'];
const statusNames = { setup_required: '需要配置', configured_unverified: '已配置 · 未验证', connected: 'MCP 已验证', failed: '连接未通过' };

export type DataConnectionStatus = 'unknown' | 'checking' | 'connected' | 'failed' | 'offline';
export interface DataConnectionState { userId: string | undefined; machineId: string; status: DataConnectionStatus }

function OfficialLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children} <ExportOutlined aria-hidden /></a>;
}

export default function DatadreamSetupPanel({ onConnectionStateChange }: { onConnectionStateChange?: (state: DataConnectionState) => void }) {
  const userId = useAuthStore((state) => state.user?.id);
  const [machines, setMachines] = useState<DaemonMachine[]>([]);
  const [machineId, setMachineId] = useState('');
  const [machinesLoading, setMachinesLoading] = useState(true);
  const [machinesError, setMachinesError] = useState('');
  const [inspection, setInspection] = useState<{ userId: string | undefined; machineId: string; result: ManagedMcpInspection } | null>(null);
  const result = inspection?.userId === userId && inspection?.machineId === machineId ? inspection.result : null;
  const setResult = useCallback((next: ManagedMcpInspection | null) => {
    setInspection(next ? { userId, machineId, result: next } : null);
  }, [userId, machineId]);
  const [busy, setBusy] = useState<'inspect' | null>(null);
  const [error, setError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const listEpoch = useRef(0);
  const actionEpoch = useRef(0);
  const actionController = useRef<AbortController | null>(null);
  const listController = useRef<AbortController | null>(null);
  const selected = machines.find((machine) => machine.id === machineId && machine.user_id === userId);
  const online = selected?.status === 'connected';
  const browserMachine = useBrowserMachine(machines, !machinesLoading);

  const refreshMachines = useCallback(async () => {
    const epoch = ++listEpoch.current;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setMachinesLoading(true); setMachinesError('');
    try {
      const next = (await listManagedMcpMachines(controller.signal)).filter((machine) => machine.user_id === userId);
      if (epoch !== listEpoch.current) return;
      setMachines(next);
      setMachineId((current) => next.some((machine) => machine.id === current) ? current : next.find((machine) => machine.status === 'connected')?.id ?? next[0]?.id ?? '');
    } catch (failure) {
      if (epoch === listEpoch.current) setMachinesError(failure instanceof Error ? failure.message : '电脑列表读取失败');
    } finally { if (epoch === listEpoch.current) setMachinesLoading(false); }
  }, [userId]);

  const run = useCallback(async () => {
    if (!machineId || !online) return;
    const epoch = ++actionEpoch.current;
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    setBusy('inspect'); setError(''); setResult(null);
    try {
      const next = await inspectManagedMcp(machineId, controller.signal);
      if (epoch !== actionEpoch.current) return;
      setResult(next);
    } catch (failure) {
      if (epoch === actionEpoch.current) setError(failure instanceof Error ? failure.message : '操作未完成，请重试');
    } finally { if (epoch === actionEpoch.current) setBusy(null); }
  }, [machineId, online, setResult]);

  useEffect(() => {
    setMachines([]); setMachineId(''); setInspection(null); setError(''); setGuideOpen(false);
    void refreshMachines();
    return () => { listEpoch.current++; listController.current?.abort(); actionEpoch.current++; actionController.current?.abort(); };
  }, [refreshMachines]);
  useEffect(() => {
    actionEpoch.current++; actionController.current?.abort(); setInspection(null); setError(''); setBusy(null); setGuideOpen(false);
    if (machineId && online) void run();
    return () => { actionEpoch.current++; actionController.current?.abort(); };
  }, [machineId, online, run]);

  const environmentOverride = result?.credential_source === 'environment' || result?.project_source === 'environment';
  const verified = result?.status === 'connected' && result.checks.some((check) => check.id === 'identity' && check.status === 'passed' && check.code === 'identity_verified');
  const connectionStatus: DataConnectionStatus = !userId ? 'unknown' : machinesLoading || busy ? 'checking'
    : machinesError ? 'failed' : !selected ? 'unknown' : !online ? 'offline'
    : error || result?.status === 'failed' || result?.status === 'setup_required' ? 'failed'
    : verified ? 'connected' : 'unknown';
  useEffect(() => {
    onConnectionStateChange?.({ userId, machineId, status: connectionStatus });
  }, [onConnectionStateChange, userId, machineId, connectionStatus]);
  const status = busy === 'inspect' ? '正在检查连接…' : result && (result.status !== 'connected' || verified) ? statusNames[result.status] : '尚未验证';

  return <section className={styles.panel} aria-label="数据连接配置">
    <div className={styles.heading}><h1>数据连接</h1><SafetyCertificateOutlined className={styles.headingIcon} aria-hidden /></div>
    <section className={styles.card} aria-label="选择电脑">
      <div className={styles.machineRow}>
        <label className={styles.machineField} htmlFor="datadream-machine">使用哪台电脑
          <select id="datadream-machine" value={machineId} disabled={machinesLoading && machines.length === 0} onChange={(event) => setMachineId(event.target.value)}>
            {!machines.length && <option value="">{machinesLoading ? '正在读取本人电脑…' : '还没有连接的电脑'}</option>}
            {machines.map((machine) => <option key={machine.id} value={machine.id}>{computerDisplayName(machine)}{browserMachine.verified ? ` · ${browserMachine.label(machine)}` : ''} · {machine.status === 'connected' ? '在线' : '离线'}</option>)}
          </select>
        </label>
        <Button icon={<ReloadOutlined />} onClick={() => void refreshMachines()} loading={machinesLoading}>刷新电脑</Button>
      </div>
      {machinesError && <p className={styles.error} role="alert">{machinesError}</p>}
      {!machinesLoading && !machines.length && <p className={styles.hint}>先在<Link to="/agents">智能体 → 连接电脑</Link>接入你自己的电脑，再回到这里配置数据连接。</p>}
      {selected && !online && <p className={styles.warning}>这台电脑已离线。请在该电脑运行连接程序，完成后刷新列表。</p>}
    </section>
    <section className={styles.card} aria-label="连接诊断">
      <div className={styles.summary}>
        <div aria-live="polite"><h2>{busy ? <Spin size="small" /> : verified ? <CheckCircleOutlined className={styles.success} /> : <ExclamationCircleOutlined className={styles.muted} />} {status}</h2>
          {result?.checked_at && <p>上次检查：{new Date(result.checked_at).toLocaleString('zh-CN')}</p>}</div>
        <div className={styles.actions}><div className={styles.setupEntry}><Button disabled={Boolean(busy)} onClick={() => setGuideOpen(true)}>基础配置设置</Button>{result && !result.key_configured && <span>第一次使用需配置</span>}</div><Button type="primary" disabled={!online || Boolean(busy)} loading={busy === 'inspect'} onClick={() => void run()}>检查连接</Button></div>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {error.includes('版本较旧') && <p className={styles.hint}><Link to="/agents">前往智能体 → 连接电脑</Link></p>}
      {result?.configuration_changed && <p className={styles.warning}>检测到配置变化，旧的验证记录已失效；以下为本次检测结果。</p>}
      {environmentOverride && <p className={styles.warning}>当前配置由环境变量覆盖。修改本机保存值不会覆盖环境变量；请在启动连接程序的位置修改并重启后重测。</p>}
      <ul className={styles.checkList}>
        {checks.map((id) => {
          const check = result?.checks.find((item) => item.id === id);
          const label = busy === 'inspect' ? '检测中' : !check ? '未检查' : check.status === 'passed' ? '通过' : check.status === 'failed' ? '需处理' : '未验证';
          return <li key={id} className={styles.checkRow}>
            <div className={styles.checkCopy}><strong>{checkNames[id]}</strong>
              {check?.status === 'failed' && <span>{checkDetails[check.code] ?? '检测未通过，请检查配置后重试。'}</span>}
              {check?.status === 'failed' && <div className={styles.helpLinks}>
                {id === 'proxy' && <OfficialLink href={links.safety}>安装安全助手</OfficialLink>}
                {id === 'identity' && <OfficialLink href={links.identity}>查看身份配置指引</OfficialLink>}
                {id === 'credential' && <OfficialLink href={links.key}>创建 API Key</OfficialLink>}
                <button type="button" onClick={() => setGuideOpen(true)}>如何处理</button>
              </div>}
            </div><span className={`${styles.checkStatus} ${check?.status === 'passed' ? styles.success : check?.status === 'failed' ? styles.warning : styles.muted}`}>{label}</span>
          </li>;
        })}
      </ul>
    </section>
    {guideOpen && <DatadreamConfigurationModal key={`${userId}:${machineId}`} userId={userId ?? ''} machineId={machineId} machineName={selected ? computerDisplayName(selected) : ''} online={Boolean(online)} onClose={() => setGuideOpen(false)} onResult={setResult} />}
  </section>;
}

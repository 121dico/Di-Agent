import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Modal, Spin } from 'antd';
import { Link } from 'react-router-dom';
import { createManagedMcpSetupSession, inspectManagedMcp, managedMcpErrorMessage, saveManagedMcpConfiguration, type ManagedMcpInspection, type ManagedMcpSetupSession } from '@/api/managedMcp';
import styles from './DatadreamSetupPanel.module.css';
import DatadreamSetupGuide, { type DatadreamGuideTopic } from './DatadreamSetupGuide';

interface DatadreamConfigurationModalProps {
  userId: string;
  machineId: string;
  machineName: string;
  online: boolean;
  onClose: () => void;
  onResult: (result: ManagedMcpInspection | null) => void;
}
function HelpLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

const DatadreamConfigurationModal: React.FC<DatadreamConfigurationModalProps> = ({ userId, machineId, machineName, online, onClose, onResult }) => {
  const [session, setSession] = useState<ManagedMcpSetupSession | null>(null);
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [busy, setBusy] = useState<'prepare' | 'save' | 'inspect' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [guide, setGuide] = useState<DatadreamGuideTopic>('key');
  const [guideOpen, setGuideOpen] = useState(false);
  const [savedProjectCode, setSavedProjectCode] = useState('');
  const [canLaunch, setCanLaunch] = useState(false);
  const [launchRequested, setLaunchRequested] = useState(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const begin = () => { controller.current?.abort(); controller.current = new AbortController(); return { current: ++epoch.current, signal: controller.current.signal }; };
  const clear = () => { epoch.current++; controller.current?.abort(); setApiKey(''); setProjectCode(''); setSession(null); };

  const prepare = useCallback(async () => {
    if (!online || !userId || !machineId) return;
    const { current, signal } = begin();
    setApiKey(''); setSession(null); setBusy('prepare'); setError(''); setNotice(''); setCanLaunch(false); setLaunchRequested(false);
    try {
      const next = await createManagedMcpSetupSession(machineId, signal);
      if (epoch.current !== current) return;
      if (!next.setup_session) { setError(managedMcpErrorMessage(next.error_code)); return; }
      setSession(next.setup_session); setKeyConfigured(next.key_configured); setProjectCode(next.project_code);
      setSavedProjectCode(next.project_code);
      setCanLaunch(next.setup_session.supported && next.key_configured && Boolean(next.project_code));
    } catch (failure) {
      if (epoch.current === current) setError(failure instanceof Error ? failure.message : '配置准备失败，请重试。');
    } finally { if (epoch.current === current) setBusy(null); }
  }, [online, machineId, userId]);

  useEffect(() => {
    void prepare();
    return () => { epoch.current++; controller.current?.abort(); };
  }, [prepare]);

  const save = async () => {
    if (!session?.supported || busy) return;
    if (!codeValid || !keyValid) { setError(managedMcpErrorMessage('invalid_configuration')); return; }
    const { current, signal } = begin();
    setBusy('save'); setError(''); setNotice('');
    let persisted = false;
    try {
      const pending = saveManagedMcpConfiguration(machineId, userId, session, apiKey, projectCode, signal);
      // 一次性会话不能重复提交；密文生成后立即清空可见草稿。
      setApiKey(''); setSession(null); setCanLaunch(false); setLaunchRequested(false); onResult(null);
      const saved = await pending;
      if (epoch.current !== current) return;
      if (!saved.saved) { setError(managedMcpErrorMessage(saved.error_code)); return; }
      persisted = true;
      setProjectCode(saved.project_code); setKeyConfigured(saved.key_configured); onResult(saved);
      setSavedProjectCode(saved.project_code); setCanLaunch(saved.key_configured && Boolean(saved.project_code));
      setNotice('已保存到所选电脑，正在验证真实 MCP 连接…'); setBusy('inspect');
      const checked = await inspectManagedMcp(machineId, signal);
      if (epoch.current !== current) return;
      onResult(checked);
      setNotice(checked.status === 'connected' ? '已保存，MCP 已验证。项目和表权限仍在实际查询时验证。' : '已保存，但 MCP 连接尚未通过。请按页面诊断检查安全助手、Key 和网络。');
    } catch (failure) {
      if (epoch.current === current) {
        setApiKey(''); setSession(null);
        setNotice(persisted ? '已保存到所选电脑，但连接检查未完成。关闭后可重新检查连接，无需重复保存。' : '');
        setError(failure instanceof Error ? failure.message : '保存未完成，请重新准备配置。');
      }
    } finally { if (epoch.current === current) setBusy(null); }
  };

  const supported = Boolean(session?.supported && online);
  const disabled = !supported || Boolean(busy);
  const codeValid = /^[A-Za-z0-9_-]{1,128}$/.test(projectCode.trim()) && !/^\d+$/.test(projectCode.trim());
  const normalizedKey = apiKey.trim().replace(/^Bearer\s+/i, '');
  const keyValid = normalizedKey === '' ? keyConfigured : normalizedKey.length >= 16 && normalizedKey.length <= 4096 && /^[A-Za-z0-9._~+/=-]+$/.test(normalizedKey);
  const close = () => { clear(); onClose(); };
  const launchEnabled = online && canLaunch && !busy && codeValid && !apiKey.trim() && projectCode.trim() === savedProjectCode;
  const recheck = async () => {
    if (!launchEnabled) return;
    const { current, signal } = begin();
    setBusy('inspect'); setError(''); setNotice('正在检查安全助手与 MCP 连接…');
    onResult(null);
    try {
      const checked = await inspectManagedMcp(machineId, signal);
      if (epoch.current !== current) return;
      onResult(checked);
      setNotice(checked.status === 'connected' ? 'MCP 已验证。项目和表权限仍在实际查询时验证。' : '连接尚未通过，请确认所选电脑的安全助手已登录、智能体安全防护已开启，再重试。');
    } catch (failure) {
      if (epoch.current === current) { setNotice(''); setError(failure instanceof Error ? failure.message : '连接检查失败，请重试。'); }
    } finally { if (epoch.current === current) setBusy(null); }
  };
  return <><Modal title="基础配置设置" open onCancel={close} footer={null} width={640} className={styles.guide}>
    <p className={styles.firstUse}>第一次使用需配置</p>
    <p className={styles.hint}>请依次完成 1、2、3 步。仅填写 Key 或项目 Code，不能完成连接。</p>
    <p className={styles.guideIntro}>配置目标：<strong>{machineName || '请先选择本人电脑'}</strong>。在这里填写，凭据加密转发到所选电脑并仅在该电脑保存；服务器不保存明文 Key。</p>
    {window.location.protocol === 'http:' && <p className={styles.warning}>当前页面使用 HTTP，请仅在可信公司内网中操作。加密转发不能替代 HTTPS，也不能防止页面被篡改。</p>}
    {!online && <p className={styles.warning}>所选电脑未连接。请到<Link to="/agents">智能体 → 连接电脑</Link>完成连接后返回。</p>}
    {busy === 'prepare' && <p className={styles.hint} role="status"><Spin size="small" /> 正在检查配置能力…</p>}
    {session && !session.supported && <p className={styles.warning} role="alert">{managedMcpErrorMessage(session.reason)}{session.reason === 'unsupported_platform' && ' Windows 请设置 DI_AGENT_DATADREAM_API_KEY 和 DI_AGENT_DATADREAM_PROJECT_CODE 环境变量，并在任务结束后重启连接程序。'}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {error.includes('版本较旧') && <p className={styles.hint}><Link to="/agents">前往智能体 → 连接电脑</Link></p>}
    <form className={styles.configForm} onSubmit={(event) => { event.preventDefault(); void save(); }} autoComplete="off">
      <section className={styles.formField} aria-labelledby="datadream-key-heading">
        <div className={styles.stepHeading}><h3 id="datadream-key-heading"><span className={styles.stepNumber}>1</span><label htmlFor="datadream-api-key">个人 API Key</label></h3><Button onClick={() => { setGuide('key'); setGuideOpen(true); }} aria-label="个人 API Key 详细引导">详细引导</Button></div>
        <div className={styles.helpLinks}><HelpLink href="https://mcphub.intra.xiaojukeji.com/square?action=open_tokens">创建 API Key</HelpLink></div>
        <Input.Password id="datadream-api-key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={disabled} autoComplete="new-password" maxLength={8192} placeholder={keyConfigured ? '已配置；留空保留，粘贴新 Key 可替换' : '粘贴你创建的 API Key'} />
        <p className={styles.footnote}>{keyConfigured ? '已保存的 Key 不会回显。留空仅更新项目 Code。' : '请使用本人的新版 API Key；可直接粘贴 Bearer 后的值。'}</p>
      </section>
      <section className={styles.formField} aria-labelledby="datadream-project-heading">
        <div className={styles.stepHeading}><h3 id="datadream-project-heading"><span className={styles.stepNumber}>2</span><label htmlFor="datadream-project-code">项目 Code</label></h3><Button onClick={() => { setGuide('project'); setGuideOpen(true); }} aria-label="项目 Code 详细引导">详细引导</Button></div>
        <div className={styles.helpLinks}><HelpLink href="https://studio.data.didichuxing.com/">打开数据平台</HelpLink><HelpLink href="https://cooper.didichuxing.com/knowledge/2199579337142/2207638044119">官方获取指引</HelpLink></div>
        <Input id="datadream-project-code" value={projectCode} onChange={(event) => setProjectCode(event.target.value)} disabled={disabled} maxLength={128} placeholder="例如 epower_platform" autoComplete="off" status={projectCode && !codeValid ? 'error' : undefined} />
        <p className={styles.footnote}>复制项目设置里的项目 Code，不是数字 projectId。{projectCode && !codeValid && '当前格式不正确，请检查。'}</p>
      </section>
      <section className={styles.formField} aria-labelledby="datadream-safety-heading">
        <div className={styles.stepHeading}><h3 id="datadream-safety-heading"><span className={styles.stepNumber}>3</span>安全助手连接</h3></div>
        <p className={styles.hint}>保存前两步后，打开安全助手登录公司账号，并确认「智能体安全」防护已开启。</p>
        <p className={styles.footnote}>按钮打开当前浏览器所在电脑的安全助手。如果配置目标「{machineName}」是另一台电脑，请在那台电脑完成登录。</p>
        <div className={styles.actions}>
          <Button href={launchEnabled ? 'lca://openWebviewPage?url=%2Fai-protection&isMainWindow=true' : undefined} disabled={!launchEnabled} onClick={() => setLaunchRequested(true)}>打开本机安全助手</Button>
          <Button disabled={!launchEnabled} loading={busy === 'inspect'} onClick={() => void recheck()}>检查安全助手连接</Button>
        </div>
        {!launchEnabled && !busy && <p className={styles.footnote}>请先完成并保存第 1、2 步；如已修改配置，请重新保存。</p>}
        {launchRequested && <p className={styles.hint} role="status">已请求打开安全助手，不代表连接成功。若浏览器询问，请选择打开；未唤起时可从应用列表手动打开，登录后返回检查连接。</p>}
        <div className={styles.helpLinks}><HelpLink href="https://lca.xiaojukeji.com/">未安装？查看安装说明</HelpLink><HelpLink href="https://cooper.didichuxing.com/knowledge/share/page/uRaZEPYXmPfm">身份配置指引</HelpLink></div>
      </section>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <div className={styles.guideFooter}><Button onClick={close}>关闭</Button>{!session && !busy && online && <Button onClick={() => void prepare()}>重新准备配置</Button>}<Button htmlType="submit" type="primary" disabled={disabled || !codeValid || !keyValid} loading={busy === 'save' || busy === 'inspect'}>{busy === 'inspect' ? '正在检查连接' : '保存并检查连接'}</Button></div>
    </form>
  </Modal><DatadreamSetupGuide open={guideOpen} topic={guide} onClose={() => setGuideOpen(false)} /></>;
};

export default DatadreamConfigurationModal;

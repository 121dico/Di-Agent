import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import AuthLayout from '@/layout/AuthLayout';
import Input from '@/components/common/Input';
import Button from '@/components/common/Button';
import { useAuthStore } from '@/store/authStore';
import { useAuthProviders } from '@/hooks/useAuthProviders';
import { safeCompanyLoginUrl } from '@/api/auth';
import { AlertCircle, ArrowRight, Building2 } from 'lucide-react';
import styles from './LoginView.module.css';

const LoginView: React.FC = () => {
  const navigate = useNavigate();
  const login = useAuthStore((state) => state.login);
  const loginBoss = useAuthStore((state) => state.loginBoss);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const discovery = useAuthProviders();
  const location = useLocation();
  const callback = new URLSearchParams(location.search).get('company') === '1';
  const callbackStarted = useRef(false);
  const [companyPending, setCompanyPending] = useState(callback);
  const [companyError, setCompanyError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const bossReady = discovery.providers?.boss_ready === true;

  useEffect(() => {
    if (!callback || discovery.loading || callbackStarted.current) return;
    callbackStarted.current = true;
    if (!bossReady) {
      setCompanyPending(false);
      setCompanyError('公司登录暂不可用，请使用本地测试账号或联系管理员');
      return;
    }
    void loginBoss().then(() => navigate('/', { replace: true })).catch((reason: unknown) => {
      setCompanyError(reason instanceof Error ? reason.message : '公司登录验证失败');
    }).finally(() => setCompanyPending(false));
  }, [callback, discovery.loading, bossReady, loginBoss, navigate]);

  const companyUrl = discovery.providers?.boss_ready && discovery.providers.boss_enabled
    ? safeCompanyLoginUrl(discovery.providers.login_url) : null;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!discovery.localEnabled || companyPending) return;
      setLocalError('');
      if (!username.trim() || !password.trim()) {
        setLocalError('请输入用户名和密码');
        return;
      }
      try {
        await login(username.trim(), password);
        navigate('/');
      } catch {
        setLocalError('用户名或密码错误');
      }
    },
    [username, password, login, navigate, discovery.localEnabled, companyPending],
  );

  return (
    <AuthLayout>
      <div className={styles.form}>
        <div className={styles.intro}>
          <span>账户访问</span>
          <h2>欢迎回来</h2>
          <p>使用公司账号登录，继续你的协作任务与数据工作。</p>
        </div>
        <section className={styles.companySection} aria-label="公司账号登录">
          <Button type="button" className={styles.submitButton} disabled={!companyUrl || discovery.loading || loading || companyPending}
            onClick={() => { if (companyUrl) window.location.assign(companyUrl); }}>
            <Building2 size={17} aria-hidden="true" /><span>{companyPending ? '正在验证公司身份' : '公司账号登录'}</span><ArrowRight size={16} aria-hidden="true" />
          </Button>
          <p className={styles.companyStatus} role="status">
            {discovery.loading ? '正在读取登录配置…' : discovery.error ? discovery.error : companyUrl
              ? '前往公司官方登录页验证身份，Di Agent 不收集公司密码。'
              : '公司登录暂未接通，等待 Boss 接入配置。'}
          </p>
          {discovery.error && <button type="button" className={styles.retryButton} onClick={() => void discovery.reload()}>重新读取配置</button>}
          {companyError && <div className={styles.error} role="alert">{companyError}</div>}
        </section>
        {discovery.localEnabled ? <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.separator}><span>本地账号 · 测试备用</span></div>
        {(error || localError) && (
          <div className={styles.error} role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            <span>{localError || error}</span>
          </div>
        )}
        <Input
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="请输入用户名"
          autoComplete="username"
          className={styles.input}
        />
        <Input
          label="密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
          autoComplete="current-password"
          className={styles.input}
        />
        <Button type="submit" disabled={loading || companyPending} className={styles.localButton}>
          <span>{loading ? '正在登录' : '本地账号登录'}</span>
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </Button>
        <div className={styles.footer}>
          还没有测试账号？<Link to="/register">注册本地账号</Link>
        </div>
      </form> : <p className={styles.companyStatus}>当前仅开放公司账号登录，本地登录与注册已关闭。</p>}
      </div>
    </AuthLayout>
  );
};

export default LoginView;

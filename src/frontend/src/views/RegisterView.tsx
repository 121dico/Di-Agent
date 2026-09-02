import React, { useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import AuthLayout from '@/layout/AuthLayout';
import Input from '@/components/common/Input';
import Button from '@/components/common/Button';
import { useAuth } from '@/hooks/useAuth';
import { AlertCircle, ArrowRight } from 'lucide-react';
import styles from './RegisterView.module.css';

const RegisterView: React.FC = () => {
  const navigate = useNavigate();
  const { register, loading, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError('');
      if (!username.trim() || !password.trim()) {
        setLocalError('请输入用户名和密码');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('两次密码输入不一致');
        return;
      }
      try {
        await register(username.trim(), password);
        navigate('/');
      } catch {
        setLocalError('注册失败，用户名可能已存在');
      }
    },
    [username, password, confirmPassword, register, navigate],
  );

  return (
    <AuthLayout>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.intro}>
          <span>创建账户</span>
          <h2>加入工作区</h2>
          <p>创建账户，开始组织你的 Agent 协作流程。</p>
        </div>
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
          autoFocus
          className={styles.input}
        />
        <Input
          label="密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
          autoComplete="new-password"
          className={styles.input}
        />
        <Input
          label="确认密码"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="请再次输入密码"
          autoComplete="new-password"
          className={styles.input}
        />
        <Button type="submit" disabled={loading} className={styles.submitButton}>
          <span>{loading ? '正在创建' : '创建并进入'}</span>
          <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
        </Button>
        <div className={styles.footer}>
          已有账号？<Link to="/login">登录</Link>
        </div>
      </form>
    </AuthLayout>
  );
};

export default RegisterView;

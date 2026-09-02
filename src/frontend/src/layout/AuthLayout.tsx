import React from 'react';
import { ArrowUpRight, BarChart3, MessagesSquare, Workflow } from 'lucide-react';
import TitleBar from '@/components/common/TitleBar';
import styles from './AuthLayout.module.css';

interface AuthLayoutProps {
  children: React.ReactNode;
}

const capabilities = [
  {
    icon: MessagesSquare,
    title: '多 Agent 协作',
    detail: '把对话、上下文与执行过程放在同一个工作区。',
  },
  {
    icon: Workflow,
    title: '任务过程可追溯',
    detail: '从拆解到交付，每一步进展都清晰可见。',
  },
  {
    icon: BarChart3,
    title: '数据与报表工作流',
    detail: '连接业务数据，沉淀可复用的分析与报告。',
  },
];

const AuthLayout: React.FC<AuthLayoutProps> = ({ children }) => (
  <div className={styles.container}>
    <TitleBar />
    <main className={styles.shell}>
      <section className={styles.brandPanel} aria-label="Di Agent 产品介绍">
        <header className={styles.brandHeader}>
          <span className={styles.brandMark} aria-hidden="true">D</span>
          <span className={styles.brandName}>Di Agent</span>
        </header>

        <div className={styles.brandStory}>
          <p className={styles.eyebrow}><i />MULTI-AGENT WORKSPACE</p>
          <h1>让一支协作的<br />Agent 团队推进工作。</h1>
          <p className={styles.brandDescription}>
            连接对话、任务、知识与数据，在一个清晰的工作空间里持续交付结果。
          </p>
        </div>

        <div className={styles.capabilityList} aria-label="核心能力">
          {capabilities.map(({ icon: Icon, title, detail }, index) => (
            <article key={title} className={styles.capabilityItem}>
              <span className={styles.capabilityIndex}>0{index + 1}</span>
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <div>
                <strong>{title}</strong>
                <p>{detail}</p>
              </div>
              <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden="true" />
            </article>
          ))}
        </div>

        <footer className={styles.brandFooter}>
          <span>DI AGENT · TEAM WORKSPACE</span>
          <span>2026</span>
        </footer>
      </section>

      <section className={styles.authPanel} aria-label="账户访问">
        <div className={styles.formShell}>{children}</div>
        <p className={styles.authFootnote}>账号访问由当前工作区统一管理</p>
      </section>
    </main>
  </div>
);

export default AuthLayout;

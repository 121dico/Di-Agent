import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReportAgentWidget } from '@/components/report/ReportAgentWidget';
import type { AgentChatConfig } from '@/components/report/ReportAgentChat';
import { ensureDeliveryAgentSession } from '@/api/deliveryAgentSession';
import { replaceDeliveryAgentContext, type DeliveryAgentContext } from '@/components/report/deliveryAgentContext';
import styles from './DeliveryAnalysisView.module.css';

const deliveryAnalysisURL = (() => {
  const configured = import.meta.env.VITE_DELIVERY_ANALYSIS_URL as string | undefined;
  if (configured) return configured;
  if (import.meta.env.DEV) {
    const host = window.location.hostname || 'localhost';
    return `http://${host}:4173/`;
  }
  return '/delivery-analysis-app/';
})();

const deliveryAgentConfig: AgentChatConfig = {
  agentName: '投放agent', workspace: 'delivery', contextLabel: '当前投放', ensureSession: ensureDeliveryAgentSession,
  replaceContext: replaceDeliveryAgentContext,
};

const DeliveryAnalysisView: React.FC = () => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [context, setContext] = useState<DeliveryAgentContext>({ reportName: '当前投放', cities: [] });
  const readContext = () => {
    const frameWindow = frameRef.current?.contentWindow as (Window & { deliveryContext?: () => string }) | null;
    const raw = frameWindow?.deliveryContext?.();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { taskName?: string; partition?: string; date?: string; selectedGroup?: string; dimension?: string };
      setContext((previous) => {
        if (previous.pageData === raw) return previous;
        return {
          ...previous,
          reportName: parsed.taskName || '当前投放',
          dataDate: parsed.partition || parsed.date,
          dateRange: [parsed.date, parsed.selectedGroup, parsed.dimension].filter(Boolean).join(' · ') || undefined,
          pageData: raw,
        };
      });
    } catch {
      setContext((previous) => previous.pageData === raw ? previous : { ...previous, pageData: raw });
    }
  };
  useEffect(() => {
    const timer = window.setInterval(readContext, 800);
    return () => window.clearInterval(timer);
  }, []);
  const config = useMemo(() => deliveryAgentConfig, []);
  return <div className={styles.page}>
    <iframe ref={frameRef} className={styles.frame} src={deliveryAnalysisURL} title="投放分析" allow="clipboard-read; clipboard-write" onLoad={readContext} />
    <ReportAgentWidget context={context} config={config} />
  </div>;
};

export default DeliveryAnalysisView;

import React from 'react';
import { BarChart3, ChevronRight } from 'lucide-react';
import type { CardProps, PersonalReportCard as PersonalReportCardData } from '@/types/card';
import { usePersonalReportStore } from '@/store/personalReportStore';
import styles from './PersonalReportCard.module.css';

export const PersonalReportCard: React.FC<CardProps<PersonalReportCardData>> = ({ card }) => {
  const openWorkspace = usePersonalReportStore((state) => state.openWorkspace);

  return (
    <button className={styles.card} type="button" onClick={() => void openWorkspace(card.report_id)}>
      <span className={styles.icon}><BarChart3 size={18} /></span>
      <span className={styles.content}>
        <strong>{card.title || '个人报表已生成'}</strong>
        <small>{card.summary || '查看真实数据、图表与分析结论'}</small>
        {card.source_partition && <em>数据分区 {card.source_partition}</em>}
      </span>
      <ChevronRight size={17} />
    </button>
  );
};

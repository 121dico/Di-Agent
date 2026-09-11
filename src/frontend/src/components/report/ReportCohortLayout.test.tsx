// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import styles from '@/views/ReportsView.module.css';
import { readFileSync } from 'node:fs';
import { ReportCohortSections } from './ReportCohortSections';

it('does not place two report sections in the same explicit desktop grid row', () => {
  const host = document.createElement('div');
  const style = document.createElement('style');
  const css = readFileSync('src/views/ReportsView.module.css', 'utf8');
  // 从生产样式读取网格位置，而非复制一个不会随真实布局变化的测试样式。
  style.textContent = ['overviewBlock', 'trendBlock', 'fullWidthBlock'].map((name) => {
    const rule = css.match(new RegExp(`\\.${name}\\s*\\{([^}]+)\\}`));
    return `.${styles[name]} { ${rule?.[1] ?? ''} }`;
  }).join('\n');
  host.innerHTML = renderToStaticMarkup(<ReportCohortSections analytics={null} loading={false} error=""
    renderDistribution={() => null} renderChart={() => null} renderGrowthChart={() => null} renderBar={() => null} />);
  document.head.append(style);
  document.body.append(host);
  try {
    const sections = [...host.querySelectorAll(':scope > section')];
    const occupied = sections.map((section) => getComputedStyle(section).gridRow).filter((row) => row && row !== 'auto');
    expect(new Set(occupied).size).toBe(occupied.length);
    expect(sections.slice(0,4).map((section) => section.id)).toEqual(['report-overview', 'report-increments', 'report-order-cohort', 'report-trend']);
  } finally { host.remove(); style.remove(); }
});

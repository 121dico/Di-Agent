// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ReportRegionFilter } from './ReportRegionFilter';
import { expandChinaRegionSelection } from './ChinaRegionPicker';

it('keeps the map visible, narrows a province to a recommended city, and resets selection', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const Harness = () => {
    const [cities, onCities] = useState<string[]>([]);
    const [provinces, onProvinces] = useState<string[]>([]);
    return <><ReportRegionFilter cities={cities} provinces={provinces} onCities={onCities} onProvinces={onProvinces} onReset={() => { onCities([]); onProvinces([]); }} /><output>{expandChinaRegionSelection(cities, provinces).join(',')}</output></>;
  };
  try {
    act(() => root.render(<Harness />));
    expect(host.querySelector('[aria-label="搜索城市"]')).not.toBeNull();
    expect(host.querySelector('svg[aria-label="中国省级行政区域交互地图"]')).not.toBeNull();
    act(() => host.querySelector('[aria-label="选择浙江省"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.textContent).not.toContain('当前区域');
    expect(host.textContent).not.toContain('时间范围');
    expect(host.querySelector('output')?.textContent).toContain('宁波市');
    const clickText = (text: string) => act(() => [...host.querySelectorAll('button')].find((button) => button.textContent === text)?.click());
    clickText('杭州');
    expect(host.querySelector('output')?.textContent).toBe('杭州市');
    clickText('上海');
    expect(host.querySelector('output')?.textContent).toBe('杭州市,上海市');
    clickText('重置');
    expect(host.querySelector('output')?.textContent).toBe('');
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

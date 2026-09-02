// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChinaRegionMapPanel } from './ChinaRegionPicker';

describe('ChinaRegionMapPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens a province and returns the selected city through the public callback', () => {
    const onChange = vi.fn();
    act(() => root.render(<ChinaRegionMapPanel value={[]} onChange={onChange} />));

    const hebei = container.querySelector('[aria-label="选择河北省"]');
    expect(hebei).not.toBeNull();
    act(() => hebei?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.textContent).toContain('河北省');
    const shijiazhuang = container.querySelector('button[aria-label="选择石家庄市"]');
    expect(shijiazhuang).not.toBeNull();
    act(() => shijiazhuang?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith(['石家庄市']);
  });

  it('selects a municipality as a province without selecting its city value', () => {
    const onChange = vi.fn();
    const onProvinceChange = vi.fn();
    act(() => root.render(<ChinaRegionMapPanel value={[]} onChange={onChange} provinceCodes={[]} onProvinceChange={onProvinceChange} />));

    const beijing = container.querySelector('[aria-label="选择北京市"]');
    expect(beijing).not.toBeNull();
    act(() => beijing?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onProvinceChange).toHaveBeenCalledWith(['110000']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears all selected cities from the panel', () => {
    const onChange = vi.fn();
    act(() => root.render(<ChinaRegionMapPanel value={['北京市', '上海市']} onChange={onChange} />));

    const clear = container.querySelector('button[aria-label="清空已选城市"]');
    expect(clear).not.toBeNull();
    act(() => clear?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('highlights every selected region block from city values without suffixes', () => {
    const onChange = vi.fn();
    act(() => root.render(<ChinaRegionMapPanel value={['上海', '杭州']} onChange={onChange} />));

    expect(container.querySelector('[aria-label="选择上海市"]')?.getAttribute('data-selected')).toBe('true');
    expect(container.querySelector('[aria-label="选择浙江省"]')?.getAttribute('data-selected')).toBe('true');
  });

  it('keeps previous cities when selecting a city from another region', () => {
    const onChange = vi.fn();
    act(() => root.render(<ChinaRegionMapPanel value={['上海市']} onChange={onChange} />));

    const zhejiang = container.querySelector('[aria-label="选择浙江省"]');
    act(() => zhejiang?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const hangzhou = container.querySelector('button[aria-label="选择杭州市"]');
    act(() => hangzhou?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onChange).toHaveBeenCalledWith(['上海市', '杭州市']);
  });

  it('toggles independent province blocks without auto-selecting their cities', () => {
    const Harness = () => {
      const [value, setValue] = useState<string[]>([]);
      const [provinceCodes, setProvinceCodes] = useState<string[]>([]);
      return <>
        <ChinaRegionMapPanel value={value} onChange={setValue} provinceCodes={provinceCodes} onProvinceChange={setProvinceCodes} />
        <output aria-label="selected-city-values">{value.join('、')}</output>
        <output aria-label="selected-province-values">{provinceCodes.join('、')}</output>
      </>;
    };
    act(() => root.render(<Harness />));

    const zhejiang = container.querySelector('[aria-label="选择浙江省"]');
    const shanghai = container.querySelector('[aria-label="选择上海市"]');
    act(() => zhejiang?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[aria-label="selected-city-values"]')?.textContent).toBe('');
    expect(container.querySelector('[aria-label="selected-province-values"]')?.textContent).toBe('330000');
    expect(zhejiang?.getAttribute('data-complete')).toBe('true');
    expect(container.querySelector('button[title="移除浙江省"]')).not.toBeNull();

    act(() => shanghai?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[aria-label="selected-city-values"]')?.textContent).toBe('');
    expect(container.querySelector('[aria-label="selected-province-values"]')?.textContent).toBe('330000、310000');
    expect(shanghai?.getAttribute('data-complete')).toBe('true');

    act(() => zhejiang?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('[aria-label="selected-city-values"]')?.textContent).toBe('');
    expect(container.querySelector('[aria-label="selected-province-values"]')?.textContent).toBe('310000');
    expect(zhejiang?.getAttribute('data-selected')).toBeNull();
    expect(zhejiang?.getAttribute('data-active')).toBeNull();
    expect(shanghai?.getAttribute('data-active')).toBe('true');
  });

  it('clears the active province when the last selected province is clicked again', () => {
    const Harness = () => {
      const [provinceCodes, setProvinceCodes] = useState<string[]>([]);
      return <ChinaRegionMapPanel value={[]} onChange={() => undefined} provinceCodes={provinceCodes} onProvinceChange={setProvinceCodes} />;
    };
    act(() => root.render(<Harness />));

    const zhejiang = container.querySelector('[aria-label="选择浙江省"]');
    act(() => zhejiang?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(zhejiang?.getAttribute('data-active')).toBe('true');

    act(() => zhejiang?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(zhejiang?.getAttribute('data-selected')).toBeNull();
    expect(zhejiang?.getAttribute('data-active')).toBeNull();
    expect(container.querySelector('[aria-label="搜索当前区域城市"]')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./MessageBubble.module.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../../styles/workbench-tokens.css', import.meta.url), 'utf8');

// 原生选区无法由 jsdom 绘制；这里锁定级联范围和对比度，浏览器拖选另行验收。
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const selection = (selector: string) => rules.find(([, selectors]) =>
  selectors?.split(',').some(value => value.trim() === selector))?.[2] ?? '';
const rgb = (hex: string) => hex.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16));
const luminance = (channels: number[]) => channels.map(value => {
  const linear = value / 255;
  return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);

describe('深色消息原生文本选区', () => {
  for (const selector of ['.innerUser::selection', '.innerUser *::selection', '.innerSending::selection', '.innerSending *::selection']) {
    it(`${selector} 显式使用白字与不透明蓝底`, () => {
      const rule = selection(selector);
      expect(rule).toMatch(/color:\s*#ffffff\s*;/);
      expect(rule).toMatch(/background:\s*#335d87\s*;/);
      expect(rule).toMatch(/text-shadow:\s*none\s*;/);
    });
  }

  it('包括发送中 0.85 透明度时，选区对比度仍达到 4.5:1', () => {
    const background = selection('.innerUser::selection').match(/background:\s*(#[a-f\d]{6})/i)?.[1];
    expect(background).toBeDefined();
    for (const opacity of [1, 0.85]) {
      const blended = rgb(background!).map(value => value * opacity + 255 * (1 - opacity));
      expect(1.05 / (luminance(blended) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('不覆盖浅色回复和全局浅色选区', () => {
    expect(selection('.innerAssistant::selection')).toBe('');
    expect(tokens).toMatch(/::selection\s*\{\s*color:\s*var\(--wb-text-primary\);\s*background:\s*rgba\(10, 102, 255, 0\.16\);\s*\}/);
  });
});

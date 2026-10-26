import { expect, it } from 'vitest';
import { computerDisplayName, defaultComputerName } from './computerNames';

it('keeps manual names and gives legacy automatic names a stable non-repeating alias', () => {
  expect(computerDisplayName({ id: 'a', name: '我的分析电脑' })).toBe('我的分析电脑');
  for (let index = 0; index < 100; index++) {
    const computer = { id: `owned-machine-${index}`, name: 'computer-1543' };
    const alias = computerDisplayName(computer);
    const [primary, secondary] = alias.split('工作站 · ');
    expect(primary).not.toBe(secondary);
    expect(alias).not.toContain('computer-');
    expect(computerDisplayName({ ...computer })).toBe(alias);
  }
});

it('skips existing suggested names while respecting manual names', () => {
  expect(defaultComputerName([])).toBe('云杉工作站');
  expect(defaultComputerName([{ id: 'first', name: '云杉工作站' }, { id: 'second', name: '银杏工作站' }])).toBe('青松工作站');
});

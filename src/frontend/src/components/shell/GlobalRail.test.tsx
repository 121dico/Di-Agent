// @vitest-environment jsdom

import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalRail } from './GlobalRail';

const STORAGE_KEY = 'di_agent_global_rail_collapsed';
const railStylesheet = readFileSync(
  resolve(process.cwd(), 'src/components/shell/GlobalRail.module.css'),
  'utf8',
);

let container: HTMLDivElement;
let root: Root;

function createMediaQueryList(query: string, matches = false): MediaQueryList {
  return {
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn((query: string) => createMediaQueryList(query)),
});

function finishTransition(element: Element, propertyName: string): void {
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: propertyName });
  act(() => element.dispatchEvent(event));
}

function renderRail(): void {
  act(() => {
    root.render(
      <MemoryRouter>
        <GlobalRail
          username="测试用户"
          wsStatus="connected"
          unreadCount={3}
          onCreate={vi.fn()}
          onOpenCommand={vi.fn()}
          onLogout={vi.fn()}
        />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(window.matchMedia).mockImplementation((query) => createMediaQueryList(query));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  container.remove();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('GlobalRail collapse preference', () => {
  it('keeps one fixed D mark while the collapsed control swaps in place', () => {
    renderRail();

    expect(railStylesheet).toMatch(/\.collapsedBrandToggle:not\(\[aria-disabled='true'\]\):hover,[^{]*\{[^}]*background: var\(--wb-action-hover\);/s);
    expect(railStylesheet).toMatch(/\.collapsedBrandToggle:not\(\[aria-disabled='true'\]\):focus-visible \.brandToggleIcon/);
    expect(railStylesheet).not.toMatch(/\.railCollapsed \.brandMark/);
    expect(railStylesheet).not.toMatch(/\.railCollapsed :is\([^)]*\.brandLabel[^)]*\) \{ display: none; \}/);
    expect(railStylesheet).toMatch(/\.railToggle \{[^}]*width: 40px; height: 40px;/s);
    expect(railStylesheet).toMatch(/\.brandLabel \{[^}]*width: max\(0px, calc\(100% - 136px\)\)/s);
    expect(railStylesheet).not.toMatch(/\.brandRow \{[^}]*transition: opacity/s);
    expect(railStylesheet).not.toMatch(/\.brandRowHidden/);
    expect(railStylesheet).toMatch(/\.collapsedBrandToggle \{[^}]*left: 16px;[^}]*background: transparent;/s);
    expect(railStylesheet).toMatch(/\.brandToggleIcon \{[^}]*opacity: 0;/s);
    expect(railStylesheet).toMatch(/\.collapsedBrandToggle:not\(\[aria-disabled='true'\]\):hover \.brandToggleIcon,[^{]*\{[^}]*opacity: 1;/s);
    expect(railStylesheet).toMatch(/\.railToggle \.brandToggleIcon \{[^}]*width: 32px; height: 32px;/s);
    expect(railStylesheet).toMatch(/\.railToggle:hover \.brandToggleIcon \{ background: var\(--wb-surface-hover\); \}/);
    expect(railStylesheet).toMatch(/\.accountMeta \{ transition-duration: 0ms; transition-delay: 0ms; \}/);
  });

  it('starts expanded when no preference has been stored', () => {
    renderRail();

    const rail = container.querySelector('aside');
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="收起侧边栏"]');
    const brandMark = Array.from(container.querySelectorAll('span'))
      .find((element) => element.textContent === 'D');

    expect(rail?.getAttribute('data-collapsed')).toBe('false');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.textContent).not.toContain('D');
    expect(brandMark?.closest('button')).toBeNull();
    expect(container.textContent).toContain('Di Agent');
    expect(container.textContent).toContain('新建对话');
    expect(container.textContent).toContain('消息');
  });

  it('collapses through the brand control and persists the choice', () => {
    renderRail();

    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="收起侧边栏"]');
    const brandMark = Array.from(container.querySelectorAll('span'))
      .find((element) => element.textContent === 'D');
    act(() => toggle?.focus());
    expect(document.activeElement).toBe(toggle);
    act(() => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const rail = container.querySelector('aside');
    expect(rail?.getAttribute('data-transitioning')).toBe('true');
    expect(rail?.getAttribute('data-collapsed')).toBe('true');
    const expand = container.querySelector<HTMLButtonElement>('[aria-label="展开侧边栏"]');
    expect(expand?.textContent).not.toContain('D');
    expect(Array.from(container.querySelectorAll('span')).find((element) => element.textContent === 'D')).toBe(brandMark);
    expect(brandMark?.closest('button')).toBeNull();
    expect(document.activeElement).toBe(expand);
    expect(container.querySelector('[aria-label="新建对话"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="消息，3 条未读"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="账户设置，已连接"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="退出登录"]')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');

    act(() => expand?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(rail?.getAttribute('data-collapsed')).toBe('true');
    expect(rail?.getAttribute('data-transitioning')).toBe('true');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');

    finishTransition(rail!, 'width');
    expect(rail?.getAttribute('data-transitioning')).toBe('false');

    act(() => expand?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(rail?.getAttribute('data-collapsed')).toBe('false');
    expect(rail?.getAttribute('data-transitioning')).toBe('true');
    finishTransition(rail!, 'width');
    expect(document.activeElement).toBe(container.querySelector('[aria-label="收起侧边栏"]'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
  });

  it('restores a stored collapsed preference', () => {
    localStorage.setItem(STORAGE_KEY, '1');

    renderRail();

    expect(container.querySelector('aside')?.getAttribute('data-collapsed')).toBe('true');
    expect(container.querySelector('[aria-label="展开侧边栏"]')).not.toBeNull();
  });

  it('treats an invalid stored value as expanded', () => {
    localStorage.setItem(STORAGE_KEY, 'unexpected');

    renderRail();

    expect(container.querySelector('aside')?.getAttribute('data-collapsed')).toBe('false');
    expect(container.querySelector('[aria-label="收起侧边栏"]')).not.toBeNull();
  });

  it('keeps the in-session toggle usable when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    renderRail();
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="收起侧边栏"]');
    act(() => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const rail = container.querySelector('aside');

    expect(rail?.getAttribute('data-collapsed')).toBe('true');
    expect(container.querySelector('[aria-label="展开侧边栏"]')).not.toBeNull();
  });

  it('switches immediately when reduced motion is preferred', () => {
    vi.mocked(window.matchMedia).mockImplementation((query) => (
      createMediaQueryList(query, query === '(prefers-reduced-motion: reduce)')
    ));
    renderRail();

    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="收起侧边栏"]');
    act(() => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(container.querySelector('aside')?.getAttribute('data-collapsed')).toBe('true');
    expect(container.querySelector('aside')?.getAttribute('data-transitioning')).toBe('false');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('recovers when the width transition event never arrives', () => {
    vi.useFakeTimers();
    renderRail();

    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="收起侧边栏"]');
    act(() => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.querySelector('aside')?.getAttribute('data-transitioning')).toBe('true');

    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelector('aside')?.getAttribute('data-transitioning')).toBe('false');
  });
});

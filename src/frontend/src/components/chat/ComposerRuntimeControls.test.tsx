// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ComposerApprovalControl,
  ComposerRuntimeControls,
} from './ComposerRuntimeControls';
import { DEFAULT_AGENT_RUNTIME_CONFIG } from './agentRuntime';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

beforeAll(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

afterEach(() => {
  mounted.splice(0).forEach(({ container, unmount }) => {
    act(() => unmount());
    container.remove();
  });
  document.querySelectorAll('.ant-dropdown').forEach((node) => node.remove());
});

describe('Composer runtime controls', () => {
  it('exposes model, reasoning, and fast service tier as independent controls', () => {
    const markup = renderToStaticMarkup(
      <ComposerRuntimeControls
        value={{
          ...DEFAULT_AGENT_RUNTIME_CONFIG,
          model: 'gpt-5.6-sol',
          reasoning_effort: 'high',
        }}
        onChange={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="选择模型，当前 5.6 Sol"');
    expect(markup).toContain('aria-label="选择推理强度，当前 高"');
    expect(markup).toContain('aria-label="极速模式，当前关闭"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('5.6 Sol');
    expect(markup).toContain('高');
    expect(markup).not.toContain('选择审批模式');
  });

  it('toggles priority independently and disables it for unsupported models', () => {
    const onChange = vi.fn();
    const priorityMarkup = renderToStaticMarkup(
      <ComposerRuntimeControls
        value={{ ...DEFAULT_AGENT_RUNTIME_CONFIG, model: 'gpt-5.6-sol', service_tier: 'priority' }}
        onChange={onChange}
      />,
    );
    expect(priorityMarkup).toContain('aria-label="极速模式，当前开启"');
    expect(priorityMarkup).toContain('aria-pressed="true"');

    const unsupportedMarkup = renderToStaticMarkup(
      <ComposerRuntimeControls
        value={{ ...DEFAULT_AGENT_RUNTIME_CONFIG, model: 'gpt-5.4-mini' }}
        onChange={onChange}
      />,
    );
    expect(unsupportedMarkup).toContain('aria-label="极速模式不可用：当前模型不支持"');
    expect(unsupportedMarkup).toContain('disabled=""');
  });

  it('keeps approval as a separate left-side control', () => {
    const markup = renderToStaticMarkup(
      <ComposerApprovalControl
        value={{ ...DEFAULT_AGENT_RUNTIME_CONFIG, approval_mode: 'full' }}
        onChange={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="选择审批模式，当前 完全访问"');
    expect(markup).toContain('完全访问');
  });

  it('keeps the selected full-access row transparent with warning text', () => {
    const css = readFileSync('src/components/chat/ComposerControls.module.css', 'utf8');
    expect(css).toContain('.dangerMenuItem:global(.ant-dropdown-menu-item-selected)');
    expect(css).toMatch(/\.checkMenu \.dangerMenuItem[^}]*color: var\(--wb-warning, #d75b16\) !important;\s*background: transparent !important;/);
    expect(css).not.toMatch(/dangerMenuItem[^}]*background:\s*(?:#000|black|rgba\(0,\s*0,\s*0)/);
  });

  it('offers the full model list and emits only the selected model change', async () => {
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(
      <ComposerRuntimeControls value={DEFAULT_AGENT_RUNTIME_CONFIG} onChange={onChange} />,
    ));

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label^="选择模型，"]');
    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const menuText = document.body.textContent ?? '';
    for (const label of [
      'Default', '5.6 Sol', '5.6 Terra', '5.6 Luna',
      '5.5', '5.4', '5.4 Mini', '5.3 Codex Spark',
    ]) expect(menuText).toContain(label);

    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('5.4 Mini'));
    await act(async () => option?.click());
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_AGENT_RUNTIME_CONFIG,
      model: 'gpt-5.4-mini',
      service_tier: 'default',
    });
  });

  it('emits a priority service-tier change from the fast toggle', () => {
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    const value = { ...DEFAULT_AGENT_RUNTIME_CONFIG, model: 'gpt-5.6-sol' as const };
    act(() => root.render(<ComposerRuntimeControls value={value} onChange={onChange} />));

    const fastButton = container.querySelector<HTMLButtonElement>('[aria-label^="极速模式，"]');
    act(() => fastButton?.click());
    expect(onChange).toHaveBeenCalledWith({ ...value, service_tier: 'priority' });
  });

  it('opens reasoning separately and preserves the selected model', async () => {
    const onChange = vi.fn();
    const value = { ...DEFAULT_AGENT_RUNTIME_CONFIG, model: 'gpt-5.6-terra' as const };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(<ComposerRuntimeControls value={value} onChange={onChange} />));

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label^="选择推理强度，"]');
    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.trim() === '低');
    await act(async () => option?.click());
    expect(onChange).toHaveBeenCalledWith({ ...value, reasoning_effort: 'low' });
  });

  it('opens approval separately and preserves the runtime selection', async () => {
    const onChange = vi.fn();
    const value = {
      ...DEFAULT_AGENT_RUNTIME_CONFIG,
      model: 'gpt-5.6-sol' as const,
      reasoning_effort: 'high' as const,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(<ComposerApprovalControl value={value} onChange={onChange} />));

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label^="选择审批模式，"]');
    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('完全访问'));
    expect(option?.className).toContain('dangerMenuItem');
    await act(async () => option?.click());
    expect(onChange).toHaveBeenCalledWith({ ...value, approval_mode: 'full' });
  });
});

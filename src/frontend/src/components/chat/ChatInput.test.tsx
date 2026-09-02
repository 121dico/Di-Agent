// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerContextAction } from './ChatInput';
import { ComposerConversationActions } from './ComposerConversationActions';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(() => {
  mounted.splice(0).forEach(({ container, unmount }) => {
    act(() => unmount());
    container.remove();
  });
});

describe('ChatInput context action', () => {
  it('renders a dedicated context control for the composer trailing actions', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ComposerContextAction, { onOpen: vi.fn(), active: false }),
    );

    expect(markup).toContain('aria-label="上下文与检查点"');
    expect(markup).toContain('上下文');
  });
});

describe('ChatInput conversation actions', () => {
  it('renders bottom copy and Fork controls that invoke their actions', () => {
    const onCopy = vi.fn();
    const onFork = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });

    act(() => {
      root.render(React.createElement(ComposerConversationActions, {
        onCopy,
        onFork,
        copying: false,
        forking: false,
        forkDisabled: false,
      }));
    });

    const copyButton = container.querySelector<HTMLButtonElement>('[aria-label="复制对话"]');
    const forkButton = container.querySelector<HTMLButtonElement>('[aria-label="Fork 对话"]');
    expect(copyButton).not.toBeNull();
    expect(forkButton).not.toBeNull();

    act(() => {
      copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      forkButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onFork).toHaveBeenCalledOnce();
  });

  it('keeps Fork disabled when the current conversation cannot branch', () => {
    const onFork = vi.fn();
    const markup = renderToStaticMarkup(
      React.createElement(ComposerConversationActions, {
        onCopy: vi.fn(),
        onFork,
        copying: false,
        forking: false,
        forkDisabled: true,
        forkDisabledReason: '当前对话还没有可 Fork 的消息',
      }),
    );

    expect(markup).toContain('aria-label="Fork 对话"');
    expect(markup).toContain('disabled=""');
  });

  it('locks both actions and exposes loading state while a Fork is being created', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ComposerConversationActions, {
        onCopy: vi.fn(),
        onFork: vi.fn(),
        copying: false,
        forking: true,
        forkDisabled: false,
      }),
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain('ant-btn-loading');
    expect(markup).toContain('aria-label="Fork 对话"');
  });
});

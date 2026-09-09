// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ContextUsageFooterView } from './ContextUsageFooter';
import { ComposerConversationActions } from './ComposerConversationActions';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(() => {
  mounted.splice(0).forEach(({ container, unmount }) => {
    act(() => unmount());
    container.remove();
  });
});

describe('ChatInput context action', () => {
  it('renders context status directly without requiring a button click', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ContextUsageFooterView, { onOpen: vi.fn(), usages: [] }),
    );

    expect(markup).toContain('aria-label="聊天内容用量"');
    expect(markup).toContain('暂无用量记录');
    expect(markup).not.toContain('<progress');
  });

  it('keeps context outside the bordered input container and removes voice UI', () => {
    const source = readFileSync('src/components/chat/ChatInput.tsx', 'utf8');
    const contextDock = source.indexOf('<ContextUsageFooter');
    const inputRow = source.indexOf('className={styles.inputRow}');
    expect(contextDock).toBeGreaterThan(-1);
    expect(contextDock).toBeGreaterThan(inputRow);
    expect(source).not.toContain('AudioOutlined');
    expect(source).not.toContain('语音输入即将上线');
    expect(source).not.toContain('styles.voiceBtn');
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

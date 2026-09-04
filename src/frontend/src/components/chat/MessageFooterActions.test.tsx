// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageFooterActions } from './MessageFooterActions';

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(() => {
  mounted.splice(0).forEach(({ container, unmount }) => {
    act(() => unmount());
    container.remove();
  });
});

describe('MessageFooterActions', () => {
  it('places Copy and Fork directly below an agent response', () => {
    const onCopy = vi.fn();
    const onFork = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });

    act(() => root.render(<MessageFooterActions onCopy={onCopy} onFork={onFork} />));

    const copy = container.querySelector<HTMLButtonElement>('[aria-label="复制此回复"]');
    const fork = container.querySelector<HTMLButtonElement>('[aria-label="从此回复 Fork"]');
    expect(copy).not.toBeNull();
    expect(fork).not.toBeNull();
    act(() => {
      copy?.click();
      fork?.click();
    });
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onFork).toHaveBeenCalledOnce();
  });

  it('disables Fork while the selected response is not forkable', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(
      <MessageFooterActions onCopy={vi.fn()} onFork={vi.fn()} forkDisabled forking />,
    ));
    expect(container.querySelector<HTMLButtonElement>('[aria-label="从此回复 Fork"]')?.disabled).toBe(true);
  });

  it('preserves reply, pin, and more actions beside Copy and Fork', () => {
    const onReply = vi.fn();
    const onTogglePin = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ container, unmount: () => root.unmount() });
    act(() => root.render(
      <MessageFooterActions
        onCopy={vi.fn()}
        onFork={vi.fn()}
        onReply={onReply}
        onTogglePin={onTogglePin}
        menuItems={[]}
      />,
    ));
    act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="回复此消息"]')?.click();
      container.querySelector<HTMLButtonElement>('[aria-label="Pin 到上下文黑板"]')?.click();
    });
    expect(onReply).toHaveBeenCalledOnce();
    expect(onTogglePin).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="更多消息操作"]')).not.toBeNull();
  });
});

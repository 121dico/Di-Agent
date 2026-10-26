// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfigProvider } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, Message } from '@/types/message';
import { MessageBubble } from './MessageBubble';

const uploadedImage: Artifact = {
  type: 'image', version: 1, filename: 'little-duck.png', title: '池塘边的小鸭子',
  url: '/api/uploads/originals/duck.png',
};
const localPath = '/var/folders/example/image-outputs/little-duck.png';
const markdown = `给你一只小鸭子 🐤\n![池塘边的小鸭子](<${localPath}>)`;

function messageFor(text: string, artifacts: Artifact[] = [uploadedImage], blocks = true): Message {
  return {
    id: 'duck-message', conversation_id: 'image-chat', role: 'assistant',
    content: blocks ? '给你一只小鸭子 [图片：池塘边的小鸭子]' : text,
    artifacts_json: null, created_at: '2026-10-13T00:00:00Z', status: 'complete',
    ...(blocks ? { blocks_json: JSON.stringify([{ index: 0, kind: 'text', text }]) } : {}),
    artifacts,
  };
}

function staticMessage(message: Message) {
  const element = document.createElement('div');
  element.innerHTML = renderToStaticMarkup(<MessageBubble message={message} />);
  return element;
}
function inlineImage(element: ParentNode) {
  return element.querySelector<HTMLImageElement>('img[alt="池塘边的小鸭子"]');
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
  localStorage.setItem('di_agent_token', 'image-test-private-token');
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('MessageBubble image references', () => {
  it.each(['persisted', 'streaming', 'plain', 'embedded'] as const)('maps local images in %s Markdown to same-message uploads', mode => {
    const text = mode === 'embedded'
      ? `前言\n\n\`\`\`markdown\n# 图片文档\n\n${markdown}\n\n## 说明\n池塘边的一只小鸭子。\n\`\`\`` : markdown;
    const message = messageFor(text, [uploadedImage], mode === 'persisted' || mode === 'streaming');
    if (mode === 'streaming') {
      message.blocks = JSON.parse(message.blocks_json!);
      delete message.blocks_json;
      message.status = 'streaming';
    }
    const element = staticMessage(message);
    const img = inlineImage(element);
    expect(img?.getAttribute('src')).toContain('/api/uploads/originals/duck.png?token=image-test-private-token');
    expect(img?.closest('button')?.getAttribute('aria-label')).toBe('预览图片 池塘边的小鸭子');
    expect(element.innerHTML).not.toContain('/var/folders/');
  });

  it.each([
    'sandbox:/mnt/data/little-duck.png',
    'file:///Users/example/little-duck.png',
    './image-outputs/little-duck.png',
    '/tmp/little%2Dduck.png',
    'C:/Users/example/little-duck.png',
  ])('resolves local reference %s without enabling its protocol', path => {
    const element = staticMessage(messageFor(`![池塘边的小鸭子](<${path}>)`));
    expect(inlineImage(element)?.getAttribute('src')).toContain('/api/uploads/originals/duck.png');
  });

  it.each([
    ['missing', []],
    ['wrong filename despite matching title', [{ ...uploadedImage, filename: 'another.png' }]],
    ['duplicate filenames', [uploadedImage, { ...uploadedImage, url: '/api/uploads/originals/other-duck.png' }]],
    ['not an image', [{ ...uploadedImage, type: 'file' }]],
    ['external artifact', [{ ...uploadedImage, url: 'https://images.example.test/duck.png' }]],
    ['artifact is another local path', [{ ...uploadedImage, url: '/Users/example/little-duck.png' }]],
    ['artifact traverses outside uploads', [{ ...uploadedImage, url: '/api/uploads/../../logout' }]],
  ] satisfies [string, Artifact[]][])('does not invent a replacement for %s', (_name, artifacts) => {
    const element = staticMessage(messageFor(markdown, artifacts));
    expect(inlineImage(element)).toBeNull();
    expect(element.textContent).toContain('图片地址不可用');
    // The local reference itself must never become an <img src>.
    expect(Array.from(element.querySelectorAll('img')).some(image => image.getAttribute('src') === localPath)).toBe(false);
  });

  it.each(['javascript:little-duck.png', 'data:image/png;base64,little-duck.png', 'https://user:pass@example.test/little-duck.png'])('rejects unsafe source %s even when there is an artifact', path => {
    const element = staticMessage(messageFor(`![池塘边的小鸭子](<${path}>)`));
    expect(inlineImage(element)).toBeNull();
    expect(element.textContent).toContain('图片地址不可用');
  });

  it.each([true, false])('keeps external images previewable without app tokens (blocks=%s)', blocks => {
    const element = staticMessage(messageFor('![池塘边的小鸭子](https://images.example.test/duck.png)', [], blocks));
    const img = inlineImage(element);
    expect(img?.getAttribute('src')).toBe('https://images.example.test/duck.png');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img?.closest('button')).not.toBeNull();
    expect(element.innerHTML).not.toContain('image-test-private-token');
  });

  it.each(['/api/uploads/originals/duck.png', '/api/file-preview/duck.png', '/api/ppt-preview/duck.png', '/assets/duck.png', '/avatars/duck.png'])('preserves the application image route %s', path => {
    const element = staticMessage(messageFor(`![池塘边的小鸭子](${path})`, []));
    expect(inlineImage(element)?.getAttribute('src')).toContain(path);
    expect(inlineImage(element)?.closest('button')).not.toBeNull();
    if (path.startsWith('/api/')) expect(inlineImage(element)?.getAttribute('src')).toContain('token=image-test-private-token');
    else expect(inlineImage(element)?.getAttribute('src')).not.toContain('image-test-private-token');
  });

  it('preserves the default safe-link transform', () => {
    const element = staticMessage(messageFor('[恶意链接](javascript:alert%281%29)'));
    expect(element.querySelector('a')?.getAttribute('href')).not.toContain('javascript:');
  });

  it.each(['//images.example.test/little-duck.png', 'https://images.example.test/little-duck.png'])('does not substitute or authenticate an external URL matching the artifact filename: %s', path => {
    const element = staticMessage(messageFor(`![池塘边的小鸭子](${path})`));
    const src = inlineImage(element)?.getAttribute('src');
    expect(src).toBe(new URL(path, window.location.href).href);
    expect(src).not.toContain('image-test-private-token');
    expect(src).not.toContain('/api/uploads/');
  });

  it('rejects an image URL traversing outside the upload route', () => {
    const element = staticMessage(messageFor('![池塘边的小鸭子](/api/uploads/../../logout)'));
    expect(inlineImage(element)).toBeNull();
    expect(element.textContent).toContain('图片地址不可用');
  });
});

describe('live image arrival and preview', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  async function render(message: Message) {
    await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}><MessageBubble message={message} /></ConfigProvider>));
  }

  it.each([true, false])('shows late artifacts and opens inline preview instead of downloading (blocks=%s)', async blocks => {
    const message = messageFor(markdown, [], blocks);
    await render(message);
    expect(inlineImage(container)).toBeNull();
    await render({ ...message, artifacts: [uploadedImage] });
    const opener = inlineImage(container)?.closest('button');
    expect(opener).not.toBeNull();
    expect(inlineImage(container)?.closest('a[download]')).toBeNull();
    await act(async () => opener!.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('img')?.getAttribute('src')).toContain('/api/uploads/originals/duck.png');
    const original = Array.from(dialog!.querySelectorAll('a')).find(link => link.textContent === '打开原图');
    expect(original?.hasAttribute('download')).toBe(false);
    expect(dialog?.querySelector('a[download]')).not.toBeNull();
  });

  it('clears a failed thumbnail when its resolved upload URL changes', async () => {
    const message = messageFor(markdown);
    await render(message);
    await act(async () => inlineImage(container)!.dispatchEvent(new Event('error')));
    expect(inlineImage(container)).toBeNull();
    await render({ ...message, artifacts: [{ ...uploadedImage, url: '/api/uploads/originals/retried-duck.png' }] });
    expect(inlineImage(container)?.getAttribute('src')).toContain('/api/uploads/originals/retried-duck.png');
  });
});

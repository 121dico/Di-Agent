// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { MessageAttachmentView } from './MessageAttachmentView';
import type { MessageAttachment } from '@/types/attachment';
import { ArtifactCard } from './ArtifactCard';
import { safeAttachmentUrl } from './MessageImage';
import { ConfigProvider } from 'antd';

const attachment: MessageAttachment = { id: 'image', message_id: 'reply', file_name: 'picture.png', file_path: 'uploads/originals/picture.png', mime_type: 'image/png', file_size: 42, thumbnail_path: null, width: 1, height: 1, created_at: '' };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.setItem('di_agent_token', 'private-test-token');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); localStorage.clear(); });
describe('chat image viewing', () => {
  it('renders a returned image artifact as a previewable image', async () => {
    await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}><ArtifactCard artifacts={[{ type: 'image', version: 1, filename: 'returned.png', content: '', url: '/api/uploads/originals/returned.png' }]} /></ConfigProvider>));
    expect(container.querySelector('img')?.alt).toBe('returned.png');
    const opener = container.querySelector('button')!;
    opener.focus();
    await act(async () => opener.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    await act(async () => dialog.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(dialog.textContent).toContain('图片加载失败');
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  it('rejects executable/file URLs and does not authenticate unprotected same-origin routes', () => {
    expect(safeAttachmentUrl('javascript:alert(1)')).toBe('');
    expect(safeAttachmentUrl('file:///tmp/picture.png')).toBe('');
    expect(safeAttachmentUrl('/redirect?to=https://example.test')).not.toContain('private-test-token');
    expect(safeAttachmentUrl('/api/uploads/originals/picture.png')).toContain('token=private-test-token');
  });
  it('opens an enlarged preview on image click with separate original and download actions', async () => {
    await act(async () => root.render(<MessageAttachmentView attachments={[attachment]} />));
    const thumbnail = container.querySelector('img')!;
    expect(thumbnail.closest('a[download]')).toBeNull();
    const opener = container.querySelector<HTMLButtonElement>('button')!;
    opener.focus();
    await act(async () => opener.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('img')?.getAttribute('src')).toContain('/api/uploads/originals/picture.png');
    const original = Array.from(dialog.querySelectorAll('a')).find(a => a.textContent === '打开原图')!;
    expect(original.hasAttribute('download')).toBe(false);
    expect(dialog.querySelector('a[download="picture.png"]')).not.toBeNull();
  });
  it('never appends our authentication token to a third-party image URL', async () => {
    await act(async () => root.render(<MessageAttachmentView attachments={[{ ...attachment, url: 'https://example.test/picture.png' }]} />));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/picture.png');
    expect(container.innerHTML).not.toContain('private-test-token');
  });
});

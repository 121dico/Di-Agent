// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';
import { useConversationStore } from '@/store/conversationStore';
import { useMessageStore } from '@/store/messageStore';
import { invalidateMessageCache } from '@/hooks/useMessages';
import type { AttachmentPayload } from '@/types/attachment';
import { ChatWindow } from './ChatWindow';
import { MemoryRouter } from 'react-router-dom';

const payload: AttachmentPayload = {
  file_name: 'image.png', mime_type: 'image/png', file_size: 3,
  file_path: 'uploads/image.png', thumbnail_path: null, width: 1, height: 1,
};
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
let container: HTMLDivElement;
let root: Root;
let uploads: File[];
let sends: Array<Record<string, unknown>>;
let uploadResponse: (file: File) => Promise<Response>;
let failSend: boolean;
let deferredSend: Promise<Response> | undefined;

async function render(conversationId = 'images-chat') {
  await act(async () => root.render(<ChatInput conversationId={conversationId} />));
}
function paste(files: File[], text = '') {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    files, items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    getData: () => text,
  } });
  container.querySelector('textarea')!.dispatchEvent(event);
  return event;
}
const sendButton = () => container.querySelector<HTMLButtonElement>('[aria-label="发送消息"]')!;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  uploads = []; sends = []; failSend = false; deferredSend = undefined;
  uploadResponse = async () => response(payload);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/upload') {
      const file = (init?.body as FormData).get('file') as File;
      uploads.push(file);
      return uploadResponse(file);
    }
    if (url.endsWith('/messages') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      sends.push(body);
      if (deferredSend) return deferredSend;
      if (failSend) return new Response(JSON.stringify({ code: 1, message: 'Agent unavailable' }), { status: 400 });
      return response({ user_message: { id: 'sent-image', conversation_id: 'images-chat', role: 'user', content: body.content, created_at: new Date().toISOString() } });
    }
    if (url === '/api/conversations') return response(useConversationStore.getState().conversations);
    return response([]);
  }));
  invalidateMessageCache();
  useMessageStore.setState({ messages: {}, optimisticMessages: {} });
  useConversationStore.setState({ conversations: ['images-chat', 'other-chat'].map(id => ({ id, user_id: 'user', type: 'agent', peer_id: 'vision-agent', title: id, pinned: false, created_at: '', updated_at: '' })) });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('ChatInput image input', () => {
  it('keeps all restored images but requires removal when merged drafts exceed the image cap', async () => {
    await render();
    await act(async () => paste(Array.from({ length: 4 }, (_, i) => new File(['png'], `old${i}.png`, { type: 'image/png' }))));
    let rejectSend!: (response: Response) => void;
    deferredSend = new Promise(resolve => { rejectSend = resolve; });
    await act(async () => sendButton().click());
    await act(async () => paste([new File(['png'], 'new.png', { type: 'image/png' })]));
    await act(async () => rejectSend(new Response(JSON.stringify({ code: 1 }), { status: 400 })));
    expect(container.querySelectorAll('img')).toHaveLength(5);
    expect(container.textContent).toContain('最多 4 张');
    expect(sendButton().disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除附件 new.png"]')!.click());
    expect(sendButton().disabled).toBe(false);
  });
  it('merges the failed send with text and images added while that request was pending', async () => {
    await render();
    const type = (value: string) => {
      const textarea = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };
    uploadResponse = async file => response({ ...payload, file_name: file.name, file_path: `uploads/${file.name}` });
    await act(async () => { type('first question'); paste([new File(['a'], 'first.png', { type: 'image/png' })]); });
    let rejectSend!: (response: Response) => void;
    deferredSend = new Promise(resolve => { rejectSend = resolve; });
    await act(async () => sendButton().click());
    await act(async () => { type('next question'); paste([new File(['b'], 'next.png', { type: 'image/png' })]); });
    await act(async () => rejectSend(new Response(JSON.stringify({ code: 1, message: 'Agent unavailable' }), { status: 400 })));
    expect(container.querySelector('textarea')!.value).toBe('first question\n\nnext question');
    expect(container.querySelector('img[alt="first.png"]')).not.toBeNull();
    expect(container.querySelector('img[alt="next.png"]')).not.toBeNull();
    deferredSend = undefined;
    await act(async () => sendButton().click());
    expect(sends[1]).toMatchObject({ content: 'first question\n\nnext question', attachments: [
      { ...payload, file_name: 'first.png', file_path: 'uploads/first.png' },
      { ...payload, file_name: 'next.png', file_path: 'uploads/next.png' },
    ] });
  });
  it('reads clipboard image items when files is empty, and retains an image when sending fails', async () => {
    await render();
    const file = new File(['png'], 'image.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [], items: [{ kind: 'file', type: file.type, getAsFile: () => file }] } });
    await act(async () => container.querySelector('textarea')!.dispatchEvent(event));
    expect(uploads).toEqual([file]);
    failSend = true;
    await act(async () => sendButton().click());
    expect(container.textContent).toContain('发送失败，草稿和附件已保留');
    expect(container.querySelector('img[alt="image.png"]')).not.toBeNull();
    failSend = false;
    await act(async () => sendButton().click());
    expect(sends[1]).toMatchObject({ attachments: [payload] });
  });
  it('explains unsupported images and the Agent image limits instead of uploading unusable images', async () => {
    await render();
    await act(async () => paste([new File(['svg'], 'diagram.svg', { type: 'image/svg+xml' })]));
    expect(uploads).toHaveLength(0);
    expect(container.textContent).toContain('PNG、JPEG、GIF 或 WebP');
    await act(async () => paste([new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]));
    expect(uploads).toHaveLength(0);
    expect(container.textContent).toContain('4MiB');
    await act(async () => {
      paste([new File(['a'], 'a.png', { type: 'image/png' })]);
      paste(Array.from({ length: 4 }, (_, i) => new File(['b'], `b${i}.png`, { type: 'image/png' })));
    });
    expect(uploads).toHaveLength(1);
    expect(container.textContent).toContain('最多 4 张');
  });
  it('drops an image on the actual chat window and previews it before an explicit send', async () => {
    useConversationStore.setState({ activeConversationId: 'images-chat' });
    await act(async () => root.render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ChatWindow /></MemoryRouter>));
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [new File(['png'], 'image.png', { type: 'image/png' })] } });
    await act(async () => container.firstElementChild!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(container.querySelector('img[alt="image.png"]')).not.toBeNull();
    expect(sends).toEqual([]);
    await act(async () => sendButton().click());
    expect(sends[0]).toMatchObject({ attachments: [payload], agent_id: 'vision-agent' });
  });
  it('does not mix same-name uploads or carry images into a different conversation', async () => {
    const complete: Array<(response: Response) => void> = [];
    uploadResponse = () => new Promise(resolve => complete.push(resolve));
    vi.spyOn(Date, 'now').mockReturnValue(123456789);
    await render();
    await act(async () => {
      paste([new File(['one'], 'image.png', { type: 'image/png' })]);
      paste([new File(['two'], 'image.png', { type: 'image/png' })]);
    });
    await act(async () => {
      complete[1]!(response({ ...payload, file_path: 'uploads/two.png' }));
      complete[0]!(response({ ...payload, file_path: 'uploads/one.png' }));
    });
    await act(async () => sendButton().click());
    expect(sends[0]!.attachments).toEqual([
      { ...payload, file_path: 'uploads/one.png' },
      { ...payload, file_path: 'uploads/two.png' },
    ]);
    await act(async () => { paste([new File(['old'], 'old.png', { type: 'image/png' })]); });
    await render('other-chat');
    await act(async () => complete[2]!(response({ ...payload, file_name: 'old.png' })));
    expect(container.querySelector('img')).toBeNull();
    expect(sendButton().disabled).toBe(true);
  });
  it('preserves normal text paste and does not upload or prevent it', async () => {
    await render();
    act(() => { expect(paste([], 'hello').defaultPrevented).toBe(false); });
    expect(uploads).toEqual([]);
  });

  it('keeps incomplete or failed images attached and blocks Enter until they are removed', async () => {
    let finish!: (response: Response) => void;
    uploadResponse = () => new Promise(resolve => { finish = resolve; });
    await render();
    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'describe this');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      paste([new File(['png'], 'image.png', { type: 'image/png' })]);
    });
    expect(sendButton().disabled).toBe(true);
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(sends).toEqual([]);
    await act(async () => finish(new Response(JSON.stringify({ code: 1, message: 'unsupported' }), { status: 400 })));
    expect(container.textContent).toContain('上传失败');
    expect(sendButton().disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除附件 image.png"]')!.click());
    expect(sendButton().disabled).toBe(false);
  });
  it('pastes an image, previews it without sending and sends its uploaded attachment to the Agent', async () => {
    await render();
    const file = new File(['png'], 'image.png', { type: 'image/png' });
    let event!: Event;
    await act(async () => { event = paste([file]); });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toBe(file);
    expect(event.defaultPrevented).toBe(true);
    expect(container.querySelector('img[alt="image.png"]')).not.toBeNull();
    expect(sends).toEqual([]);
    await act(async () => sendButton().click());
    expect(sends).toEqual([expect.objectContaining({ content: '', agent_id: 'vision-agent', attachments: [payload] })]);
  });
});

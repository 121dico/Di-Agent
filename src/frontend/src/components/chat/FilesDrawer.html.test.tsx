// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { FilesDrawer } from './FilesDrawer';
import { DiffCard } from './cards/DiffCard';
import * as files from '@/api/files';

vi.mock('@/api/files', () => ({
  browseTree: vi.fn(), readFile: vi.fn(), fileStatus: vi.fn(), fileDiff: vi.fn(),
}));
vi.mock('./CodeSelectView', () => ({ default: ({ value }: { value: string }) => <pre>{value}</pre> }));
vi.mock('./DiffViewer', () => ({ DiffViewer: ({ open }: { open: boolean }) => open ? <div data-testid="diff-viewer" /> : null }));
let root: Root;
let container: HTMLDivElement;
const html = '<!doctype html><html><body><button>真实动画</button></body></html>';
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) });
  vi.mocked(files.browseTree).mockResolvedValue({ repoRoot: '/tmp/task', isGit: false, rootEntries: [{ name: 'index.html', type: 'file' }], changedFiles: [] });
  vi.mocked(files.readFile).mockResolvedValue({ path: '/tmp/task/index.html', content: html, size: html.length, binary: false });
  vi.mocked(files.fileStatus).mockResolvedValue([]);
  vi.mocked(files.fileDiff).mockResolvedValue({ oldContent: '', newContent: html });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
async function render(path = '/tmp/task/index.html') {
  await act(async () => root.render(<ConfigProvider theme={{ token: { motion: false } }}>
    <FilesDrawer agentId="claude" workDir="/tmp/task" initialPath={path} open onClose={() => {}} />
  </ConfigProvider>));
}
it('reads initial HTML via authenticated file API, renders sandbox and supports source mode', async () => {
  await render();
  expect(files.readFile).toHaveBeenCalledWith('claude', '/tmp/task', '/tmp/task/index.html');
  const frame = document.querySelector('iframe');
  expect(frame?.srcdoc).toBe(html);
  expect(frame?.getAttribute('sandbox')).not.toContain('allow-same-origin');
  const source = Array.from(document.querySelectorAll('label')).find(item => item.textContent?.includes('源码'));
  expect(source).toBeDefined();
  await act(async () => source!.click());
  expect(document.querySelector('iframe')).toBeNull();
  expect(document.body.textContent).toContain(html);
});
it.each([{ binary: true }, { tooLarge: true }])('does not render unsupported file: %s', async flags => {
  vi.mocked(files.readFile).mockResolvedValue({ path: '/tmp/task/index.html', content: html, size: 3000000, binary: false, ...flags });
  await render();
  expect(document.querySelector('iframe')).toBeNull();
});
it('previews a directly read HTML file even if directory listing fails', async () => {
  vi.mocked(files.browseTree).mockRejectedValueOnce(new Error('directory unavailable'));
  await render();
  expect(document.querySelector('iframe')?.srcdoc).toBe(html);
});
it('shows a readable error and retry without a broken local URL', async () => {
  vi.mocked(files.readFile).mockRejectedValueOnce(new Error('offline'));
  await render();
  expect(document.querySelector('.ant-drawer-body [role="alert"]')?.textContent).toContain('电脑在线');
  const retry = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.replace(/\s/g, '') === '重试');
  await act(async () => retry!.click());
  expect(document.querySelector('iframe')?.srcdoc).toBe(html);
});
it('ignores a late response for the previous file', async () => {
  let resolveOld!: (value: files.ReadResult) => void;
  vi.mocked(files.readFile).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  await render('/tmp/task/old.html');
  await render('/tmp/task/index.html');
  await act(async () => resolveOld({ path: '/tmp/task/old.html', content: 'OLD', size: 3, binary: false }));
  expect(document.querySelector('iframe')?.srcdoc).toBe(html);
});
it('opens the single HTML diff card directly as a webpage, without requesting git diff', async () => {
  await act(async () => root.render(<DiffCard card={{ id: 'card', type: 'diff', workDir: '/tmp/task', files: ['index.html'] }}
    agentId="claude" conversationId="chat" messageId="message" onAction={() => {}} />));
  const file = Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'index.html');
  expect(file).toBeDefined();
  await act(async () => file!.click());
  expect(files.fileDiff).not.toHaveBeenCalled();
  expect(document.querySelector('iframe')?.srcdoc).toBe(html);
});
it('keeps ordinary code files in the diff viewer', async () => {
  await act(async () => root.render(<DiffCard card={{ id: 'card', type: 'diff', workDir: '/tmp/task', files: ['app.ts'] }}
    agentId="claude" conversationId="chat" messageId="message" onAction={() => {}} />));
  await act(async () => Array.from(container.querySelectorAll('button')).find(item => item.textContent === 'app.ts')!.click());
  await act(async () => container.querySelector<HTMLElement>('li[role="button"]')!.click());
  expect(document.querySelector('[data-testid="diff-viewer"]')).not.toBeNull();
  expect(document.querySelector('iframe')).toBeNull();
  expect(files.fileDiff).toHaveBeenCalledWith('claude', '/tmp/task', 'app.ts');
});

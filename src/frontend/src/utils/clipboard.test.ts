// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

type LegacyClipboard = {
  setData: (format: string, value: string) => void;
};

function setNativeClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
}

function disableNativeClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
}

function setExecCommand(run: (name: string) => boolean) {
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(run),
  });
}

function dispatchLegacyCopy(clipboard: LegacyClipboard): boolean {
  const copyEvent = new Event('copy', { cancelable: true });
  Object.defineProperty(copyEvent, 'clipboardData', { value: clipboard });
  document.dispatchEvent(copyEvent);
  return copyEvent.defaultPrevented;
}

describe('copyText', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('writes the complete command into the legacy copy event payload', async () => {
    const command =
      'curl -fsSL http://10.190.52.164:8080/downloads/install.sh | bash -s -- --server-url http://10.190.52.164:8080 --api-key sk_machine_test';
    let copiedText: string | undefined;
    let defaultPrevented = false;

    disableNativeClipboard();
    setExecCommand((name) => {
      if (name !== 'copy') return false;
      defaultPrevented = dispatchLegacyCopy({
        setData: (format, value) => {
          if (format === 'text/plain') copiedText = value;
        },
      });
      return true;
    });

    await copyText(command);

    expect(copiedText).toBe(command);
    expect(defaultPrevented).toBe(true);
  });

  it('uses the native Clipboard API when it succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const execCommand = vi.fn(() => true);
    setNativeClipboard(writeText);
    setExecCommand(execCommand);

    await copyText('native clipboard text');

    expect(writeText).toHaveBeenCalledWith('native clipboard text');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('falls back to the copy event when the native Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    let copiedText: string | undefined;
    setNativeClipboard(writeText);
    setExecCommand((name) => {
      if (name !== 'copy') return false;
      dispatchLegacyCopy({
        setData: (format, value) => {
          if (format === 'text/plain') copiedText = value;
        },
      });
      return true;
    });

    await copyText('fallback clipboard text');

    expect(writeText).toHaveBeenCalledWith('fallback clipboard text');
    expect(copiedText).toBe('fallback clipboard text');
  });

  it('rejects after two failed legacy copy attempts and removes the textarea', async () => {
    disableNativeClipboard();
    const execCommand = vi.fn(() => false);
    setExecCommand(execCommand);

    await expect(copyText('manual copy text')).rejects.toThrow('复制失败，请手动选中文本复制');

    expect(execCommand).toHaveBeenCalledTimes(2);
    expect(document.querySelector('textarea')).toBeNull();
  });
});

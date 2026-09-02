/**
 * 复制文本到剪贴板。
 *
 * navigator.clipboard 仅在安全上下文（HTTPS 或 localhost）可用；部门内网通常
 * 通过 http://<局域网IP> 访问，此时 navigator.clipboard 为 undefined。
 * 降级方案为隐藏 textarea + document.execCommand('copy')。
 *
 * 注意：部分浏览器（尤其 Safari）在非用户手势链路（如 await 网络请求之后）调用
 * execCommand 会"假成功"——返回 true 但未写入剪贴板。这里做了三类加固：
 * 1. setSelectionRange 显式选区（Safari 对 select() 有已知怪癖）；
 * 2. 连续两次 execCommand 重试；
 * 3. 调用方应把命令同时展示在可手动选中的界面上兜底（见 ConnectComputerModal）。
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 权限被拒等场景，落入 execCommand 降级
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // 移出可视区域且不拦截点击，避免页面闪动/滚动
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.appendChild(textarea);

  const previousFocus = document.activeElement as HTMLElement | null;
  textarea.focus();
  // Safari 怪癖：select() 可能不生效，必须 setSelectionRange 显式选区
  textarea.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand('copy');
    if (!ok) {
      ok = document.execCommand('copy'); // 二次重试提高成功率
    }
  } catch {
    ok = false;
  }

  window.getSelection()?.removeAllRanges();
  previousFocus?.focus?.();
  document.body.removeChild(textarea);
  if (!ok) {
    throw new Error('复制失败，请手动选中文本复制');
  }
}

import { defaultUrlTransform, type Components, type UrlTransform } from 'react-markdown';
import type { Artifact } from '@/types/message';
import { MessageImage } from './MessageImage';
import { htmlFilePath } from './htmlFileReference';

function uploadedImageUrl(source: string): string | undefined {
  try {
    const url = new URL(source, window.location.href);
    if (url.origin === window.location.origin && !url.username && !url.password
      && /^\/api\/uploads\//.test(url.pathname)) return url.href;
  } catch { /* 无效产物地址不能作为替代图片。 */ }
  return undefined;
}

/** Agent 本地路径不是浏览器地址：仅匹配本消息上传图片的唯一同名文件，不按 alt 猜图。 */
export function resolveMarkdownImageUrl(source: string, artifacts: readonly Artifact[] = []): string {
  if (!source) return '';
  if (/^https?:\/\//i.test(source) || source.startsWith('//')) {
    try {
      const url = new URL(source, window.location.href);
      return !url.username && !url.password && ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }
  // 保留应用已有的附件预览接口和公开静态图片路径，规范化后仍须处于对应命名空间。
  const appImagePath = /^(?:\/api\/(?:uploads|file-preview|ppt-preview)\/|\/(?:assets|avatars)\/)/;
  if (appImagePath.test(source)) {
    try {
      const url = new URL(source, window.location.href);
      return url.origin === window.location.origin && appImagePath.test(url.pathname) ? url.href : '';
    } catch { return ''; }
  }
  // 在 ReactMarkdown 过滤 file:/sandbox: 之前解析本地引用，不放行其它 URI 协议。
  if (/^[a-z][a-z\d+.-]*:/i.test(source)
    && !/^(file:|sandbox:|[a-z]:[\\/])/i.test(source)) return '';
  let filename: string;
  try {
    filename = decodeURIComponent(source.replace(/^(?:file:\/\/|sandbox:)/i, '').split(/[?#]/)[0]!)
      .replace(/\\/g, '/').split('/').pop() ?? '';
  } catch { return ''; }
  if (!filename) return '';
  const matches = artifacts.filter(artifact => artifact.type === 'image' && artifact.filename === filename);
  if (matches.length !== 1 || !matches[0]?.url) return '';
  return uploadedImageUrl(matches[0].url) ?? '';
}

export function markdownImageUrlTransform(artifacts: readonly Artifact[] = []): UrlTransform {
  return (url, key, node) => node.tagName === 'img' && key === 'src'
    ? resolveMarkdownImageUrl(url, artifacts)
    : node.tagName === 'a' && key === 'href' ? htmlFilePath(url) ?? defaultUrlTransform(url) : defaultUrlTransform(url);
}

export const markdownImageComponents: Components = {
  img({ src, alt }) {
    // 上传地址变化时重新挂载预览，清除旧缩略图的加载失败状态。
    return src ? <MessageImage key={src} src={src} name={alt || 'Agent 图片'} />
      : <span role="status">图片地址不可用</span>;
  },
};

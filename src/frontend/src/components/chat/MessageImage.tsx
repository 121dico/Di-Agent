import { useState } from 'react';
import { Modal, Spin } from 'antd';
import styles from './MessageAttachmentView.module.css';

// 只向本站受保护附件接口附加凭证，绝不把登录 token 发送给外部图片站点。
export function safeAttachmentUrl(path: string): string {
  try {
    const url = new URL(path, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    const protectedPath = /^\/api\/(uploads|ppt-preview|file-preview)\//.test(url.pathname);
    if (url.origin === window.location.origin && protectedPath) {
      const token = localStorage.getItem('di_agent_token');
      if (token) url.searchParams.set('token', token);
    }
    return url.href;
  } catch { return ''; }
}

export function MessageImage({ src, thumbnail, name }: { src: string; thumbnail?: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const fileUrl = safeAttachmentUrl(src);
  const thumbUrl = safeAttachmentUrl(thumbnail || src);
  if (!fileUrl) return <span role="status">图片地址不可用</span>;
  return (
    <>
      <button type="button" className={styles.imageLink} aria-label={`预览图片 ${name}`} onClick={(event) => {
        // Markdown 图片可能被链接包裹，点击预览不得同时触发外层导航。
        event.preventDefault(); event.stopPropagation();
        setLoading(true); setFailed(false); setOpen(true);
      }}>
        {thumbnailFailed ? <span className={styles.imageUnavailable}>缩略图加载失败，点击查看原图</span>
          : <img src={thumbUrl} alt={name} className={styles.imageThumb} loading="lazy" referrerPolicy="no-referrer" onError={() => setThumbnailFailed(true)} />}
      </button>
      <Modal open={open} onCancel={() => setOpen(false)} title={name} className={styles.imageModal} destroyOnHidden
        footer={<div className={styles.imageActions}>
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">打开原图</a>
          <a href={fileUrl} download={name} rel="noreferrer" referrerPolicy="no-referrer">下载图片</a>
        </div>}>
        {open && <div className={styles.imageViewer}>
          {loading && !failed && <span className={styles.imageStatus}><Spin size="small" /> 正在加载图片…</span>}
          {failed && <span className={styles.imageStatus} role="alert">图片加载失败，请重新打开或下载原图。</span>}
          <img src={fileUrl} alt={name} className={styles.imageOriginal} referrerPolicy="no-referrer" onLoad={() => setLoading(false)} onError={() => { setFailed(true); setLoading(false); }} />
        </div>}
      </Modal>
    </>
  );
}

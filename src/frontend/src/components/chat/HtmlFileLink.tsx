import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Message } from '@/types/message';
import { useMessageStore } from '@/store/messageStore';
import { FilesDrawer } from './FilesDrawer';
import { htmlFilePath, resolveHtmlFileTarget } from './htmlFileReference';
import styles from './HtmlFileLink.module.css';

export const HtmlFileMessageContext = createContext<Message | undefined>(undefined);
const InsideLink = createContext(false);

/** 所有 Markdown 路径共用同一入口：点击才读文件，保持原有身份与 daemon 鉴权。 */
export function HtmlFileLink({ reference, children, inline = false }: { reference?: string; children: ReactNode; inline?: boolean }) {
  const message = useContext(HtmlFileMessageContext);
  const nested = useContext(InsideLink);
  const history = useMessageStore(s => message ? s.messages[message.conversation_id] : undefined);
  const [open, setOpen] = useState(false);
  const target = !nested && reference && message ? resolveHtmlFileTarget(reference, message, history) : undefined;
  if (nested) return <>{children}</>;
  if (target) return <>
    <button type="button" className={styles.fileLink} title={`预览 ${target.path}`} onClick={() => setOpen(true)}>
      <InsideLink.Provider value>{children}</InsideLink.Provider>
    </button>
    {open && <FilesDrawer key={`${target.agentId}:${target.path}`} agentId={target.agentId} workDir={target.workDir}
      initialPath={target.path} open={open} onClose={() => setOpen(false)} />}
  </>;
  if (inline) return <>{children}</>;
  // 无来源的本机文件不能退回普通 HTTP 链接，否则会打开 SPA 首页并假装成功。
  if (reference && htmlFilePath(reference)) return <span title="无法确定文件来源，请从生成它的 Agent 文件卡片打开">{children}</span>;
  const safeHref = reference && /^(https?:\/\/|mailto:)/i.test(reference) ? reference : '#';
  return <a href={safeHref} target="_blank" rel="noopener noreferrer"><InsideLink.Provider value>{children}</InsideLink.Provider></a>;
}

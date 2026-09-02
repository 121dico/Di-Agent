import React, { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MessageBlock } from '@/types/message';
import type { BlockRenderContext } from './BlockRegistry';
import styles from './Blocks.module.css';
import { registerBlock } from './BlockRegistry';
import { CodeBlock } from '../CodeBlock';

const REMARK_PLUGINS = [remarkGfm];

interface TextBlockProps {
  block: MessageBlock;
  /** streaming 状态时显示末尾闪烁光标 */
  streaming?: boolean;
  /** registry 签名要求；TextBlock 不依赖上下文，忽略 */
  ctx?: BlockRenderContext;
}

// markdown 组件映射：代码块走 CodeBlock（深底色 + 语言头 + 语法高亮 + 可折叠），
// 与 MessageBubble 的 MarkdownRenderer 视觉对齐——流式期间也能看到完整格式，
// 而不是裸 <pre><code> 的白色纯文本。
const streamMarkdownComponents: Components = {
  code({ className, children }) {
    const text = String(children ?? '');
    const isBlock = className?.startsWith('language-') || text.includes('\n');
    if (isBlock) {
      return (
        <CodeBlock className={className} expandable>
          {children}
        </CodeBlock>
      );
    }
    return <code className={styles.inlineCode}>{children}</code>;
  },
  // 外层 <pre> 由 code 组件内的 CodeBlock 接管，剥掉默认包裹
  pre({ children }) {
    return <>{children}</>;
  },
};

function TextBlockInner({ block, streaming = false }: TextBlockProps) {
  const content = useMemo(() => block.text ?? '', [block.text]);
  return (
    <div className={styles.textBlock}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={streamMarkdownComponents}>
        {content}
      </ReactMarkdown>
      {streaming && <span className={styles.streamingCursor} aria-hidden />}
    </div>
  );
}

export const TextBlock = React.memo(TextBlockInner);

// ---------------------------------------------------------------------------
// 自注册：import './TextBlock'（经 blocks/index.ts）触发 registerBlock 副作用。
// 组件定义与注册信息内聚在同一文件，便于维护。
registerBlock('text', { component: TextBlock });

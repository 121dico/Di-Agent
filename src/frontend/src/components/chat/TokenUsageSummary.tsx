import type { TokenUsage } from '@/types/tokenUsage';
import { formatTokenCount } from './contextPresentation';
import styles from './TokenUsageSummary.module.css';

const count = (value?: number) => value == null ? '未上报' : formatTokenCount(value);
export function TokenUsageSummary({ usage, title }: { usage?: TokenUsage; title: string }) {
  return <section className={styles.summary} aria-label={title}>
    <div className={styles.heading}><strong>{title}</strong><span>{usage ? `原生统计${usage.complete ? '' : ' · 部分数据'}` : '未上报'}</span></div>
    {usage ? <>
      <dl className={styles.values}>
        <div><dt>输入（含缓存）</dt><dd>{count(usage.input_tokens)}</dd></div>
        <div><dt>输出</dt><dd>{count(usage.output_tokens)}</dd></div>
        <div><dt>缓存读取</dt><dd>{count(usage.cache_read_tokens)}</dd></div>
        <div><dt>缓存写入</dt><dd>{count(usage.cache_write_tokens)}</dd></div>
        {usage.reasoning_tokens != null && <div><dt>其中推理输出</dt><dd>{count(usage.reasoning_tokens)}</dd></div>}
      </dl>
      <p>缓存已包含在输入中，推理已包含在输出中。{usage.model ? `模型：${usage.model}。` : ''}</p>
    </> : <p>此记录没有原生 token 统计，不能从回复字数还原真实消耗。</p>}
  </section>;
}

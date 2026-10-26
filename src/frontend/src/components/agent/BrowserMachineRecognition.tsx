import { Button } from 'antd';
import type { useBrowserMachine } from '@/hooks/useBrowserMachine';
import styles from './BrowserMachineRecognition.module.css';

export function BrowserMachineRecognition({ identity }: { identity: ReturnType<typeof useBrowserMachine> }) {
  return <div className={styles.recognition}>
    <Button size="small" loading={identity.checking} onClick={identity.recognize}>{identity.verified ? '重新识别本机' : '识别本机'}</Button>
    {identity.error ? <span className={styles.error} role="status">{identity.error}</span>
      : !identity.verified && <span className={styles.hint}>{window.isSecureContext ? '自动识别当前浏览器所在电脑，识别前不会标记为外部。' : 'HTTP 首次点击识别本机，打开本机验证窗口；不需要手动选择电脑。'}</span>}
  </div>;
}

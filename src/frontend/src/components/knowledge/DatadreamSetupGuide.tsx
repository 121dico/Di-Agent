import { Button, Modal } from 'antd';
import styles from './DatadreamSetupPanel.module.css';

export type DatadreamGuideTopic = 'key' | 'project';

interface GuideImage {
  src: string;
  alt: string;
  caption: string;
}

// 收到用户提供的脱敏截图后按步骤追加；不使用包含 API Key 的原始截图。
const guideContent: Record<DatadreamGuideTopic, { title: string; steps: string[]; images: GuideImage[]; href: string; linkLabel: string }> = {
  key: {
    title: '1 · 个人 API Key 详细引导',
    steps: [
      '打开 MCP Hub，使用自己的公司账号登录，进入访问令牌页面。',
      '按页面提示创建新版 API Key。不要使用其他人的 Key，也不要将完整 Key 发到聊天或截图里。',
      '复制 Authorization 中 Bearer 后面的完整值，返回基础配置设置，粘贴到「个人 API Key」。',
      '继续完成第 2 步项目 Code，点击「保存并检查连接」，再进行第 3 步。',
    ],
    images: [],
    href: 'https://mcphub.intra.xiaojukeji.com/square?action=open_tokens',
    linkLabel: '前往创建 API Key',
  },
  project: {
    title: '2 · 项目 Code 详细引导',
    steps: [
      '打开数据平台，使用自己的公司账号登录，切换到需要操作的项目。',
      '进入该项目的项目管理或项目设置，找到「项目 Code」。',
      '复制完整的项目 Code，例如 epower_platform；不要复制网址中的数字 projectId，也不要填写项目显示名称。',
      '返回基础配置设置粘贴项目 Code，确认第 1 步已配置，保存后继续第 3 步。',
    ],
    images: [],
    href: 'https://studio.data.didichuxing.com/',
    linkLabel: '前往数据平台查看项目',
  },
};

interface DatadreamSetupGuideProps {
  open: boolean;
  topic: DatadreamGuideTopic;
  onClose: () => void;
}

const DatadreamSetupGuide: React.FC<DatadreamSetupGuideProps> = ({ open, topic, onClose }) => {
  const guide = guideContent[topic];
  return <Modal title={guide.title} open={open} onCancel={onClose} width={640} className={styles.guide}
    footer={<Button onClick={onClose}>返回基础配置</Button>}>
    <p className={styles.guideIntro}>查看引导不会清空你已经填写的内容。</p>
    <ol className={styles.steps}>{guide.steps.map((step) => <li key={step}><p>{step}</p></li>)}</ol>
    {guide.images.length > 0 ? guide.images.map((image) => <figure className={styles.guideImage} key={image.src}>
      <img src={image.src} alt={image.alt} loading="lazy" /><figcaption>{image.caption}</figcaption>
    </figure>) : <p className={styles.imagePlaceholder}>图示待补充 · 目前可按上面的文字步骤完成配置。</p>}
    <a href={guide.href} target="_blank" rel="noopener noreferrer">{guide.linkLabel}</a>
  </Modal>;
};

export default DatadreamSetupGuide;

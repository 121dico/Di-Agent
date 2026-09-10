import { useEffect, useState } from 'react';
import { Alert, Form, Modal, Select, Spin } from 'antd';
import { applyReportTemplate, listReportTemplates } from '@/api/report';
import type { ReportDataSource, ReportDefinition, ReportTemplate } from '@/types/report';

interface Props {
  open: boolean;
  sources: ReportDataSource[];
  onClose: () => void;
  onApplied: (report: ReportDefinition) => void;
}

export function ReportTemplateModal({ open, sources, onClose, onApplied }: Props) {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    void listReportTemplates().then((rows) => {
      if (!active) return;
      setTemplates(rows);
      setTemplateId(rows[0]?.id ?? '');
      const compatible = sources.filter((source) => source.enabled && rows[0]?.profiles[source.api_name]);
      setSourceId((compatible.find((source) => source.api_name === 'price_sensitive_v1_2') ?? compatible[0])?.id ?? '');
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '模板加载失败，请关闭后重试');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, sources]);
  const template = templates.find((item) => item.id === templateId);
  const compatible = sources.filter((source) => source.enabled && template?.profiles[source.api_name]);
  const canApply = compatible.some((source) => source.id === sourceId) && Boolean(template);
  const apply = async () => {
    if (!canApply || saving) return;
    setSaving(true);
    setError('');
    try {
      const report = await applyReportTemplate(templateId, sourceId);
      onApplied(report);
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '生成失败，选择已保留，可重试');
    } finally { setSaving(false); }
  };
  return <Modal title="套用报表模板" open={open} onCancel={onClose} onOk={() => void apply()}
    okText="一键生成并打开" cancelText="取消" confirmLoading={saving}
    okButtonProps={{ disabled: loading || !canApply }} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving}>
    <Spin spinning={loading}>
      <Form layout="vertical">
        <Form.Item label="报表模板">
          <Select aria-label="报表模板" value={templateId || undefined} disabled={saving} onChange={(id) => { setTemplateId(id); setSourceId(''); }}
            options={templates.map((item) => ({ value: item.id, label: `${item.name} · v${item.version}` }))} />
        </Form.Item>
        <Form.Item label="数据源" extra="仅展示字段已有明确适配的数据源；生成时还会核验管理员字段白名单。">
          <Select aria-label="模板数据源" value={sourceId || undefined} disabled={saving} onChange={setSourceId} placeholder="选择数据源"
            options={compatible.map((source) => ({ value: source.id, label: source.name }))} />
        </Form.Item>
        {template && <p>{template.description}</p>}
        <p>保留原报表。再次套用相同模板和数据源会打开已有实例，不覆盖编辑。数据按真实 API 聚合，首次加载可能较慢。</p>
        {error && <Alert type="error" title={error} showIcon />}
        {!loading && compatible.length === 0 && <Alert type="warning" title="没有兼容的数据源，请管理员先登记价敏数据源与字段契约。" showIcon />}
      </Form>
    </Spin>
  </Modal>;
}

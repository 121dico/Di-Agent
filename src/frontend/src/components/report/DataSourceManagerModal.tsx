import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AutoComplete, Button, Empty, Form, Input, Modal, Spin, Switch } from 'antd';
import {
  ArrowLeftOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { message } from '@/utils/message';
import {
  createReportSource,
  getReportSourceContract,
  listReportSources,
  saveReportSourceContract,
} from '@/api/report';
import type { ReportDataSource } from '@/types/report';
import { ReportSourceCard } from '@/components/report/ReportSourceCard';
import { filterReportSources } from '@/views/reportSourceSearch';
import { groupReportSourcesByFolder } from '@/views/reportSourceFolders';
import styles from '@/views/ReportsView.module.css';

interface SourceForm {
  name: string;
  description: string;
  folder?: string;
  endpoint: string;
  api_name: string;
  app_key_env: string;
  signature_env: string;
  x_date_env?: string;
  api_example: string;
  response_example: string;
  hive_table: string;
  hive_ddl: string;
  hive_example: string;
  enabled: boolean;
}

interface DataSourceManagerModalProps {
  open: boolean;
  onClose: () => void;
}

const DataSourceManagerModal: React.FC<DataSourceManagerModalProps> = ({ open, onClose }) => {
  const [sources, setSources] = useState<ReportDataSource[]>([]);
  const [sourceView, setSourceView] = useState<'list' | 'detail'>('list');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState('');
  const [sourceFieldCount, setSourceFieldCount] = useState(0);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [sourceCatalogQuery, setSourceCatalogQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [sourceForm] = Form.useForm<SourceForm>();
  const filteredSources = useMemo(
    () => filterReportSources(sources, sourceCatalogQuery),
    [sources, sourceCatalogQuery],
  );
  const folderOptions = useMemo(() => {
    const names = Array.from(new Set(sources
      .map((source) => (source.folder ?? '').trim())
      .filter((name) => name !== '')));
    names.sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
    return names.map((name) => ({ value: name }));
  }, [sources]);
  const folderGroups = useMemo(() => groupReportSourcesByFolder(filteredSources), [filteredSources]);

  const loadSources = useCallback(async () => {
    setCatalogLoading(true);
    try {
      setSources(await listReportSources());
    } catch {
      message.error('加载数据源失败');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open === false) return;
    setSourceView('list');
    setEditingSourceId('');
    setSourceFieldCount(0);
    setSourceCatalogQuery('');
    setExpandedFolders(new Set());
    sourceForm.resetFields();
    void loadSources();
  }, [open, loadSources, sourceForm]);

  const loadSourceContract = useCallback(async (sourceId: string) => {
    if (sourceId === '') {
      setEditingSourceId('');
      setSourceFieldCount(0);
      sourceForm.resetFields();
      sourceForm.setFieldsValue({ enabled: true });
      return;
    }
    const contract = await getReportSourceContract(sourceId);
    setEditingSourceId(sourceId);
    setSourceFieldCount(contract.fields.length);
    sourceForm.setFieldsValue(contract);
  }, [sourceForm]);

  const openSourceDetail = async (sourceId: string) => {
    setSourceView('detail');
    setSourceLoading(true);
    try {
      await loadSourceContract(sourceId);
    } catch {
      message.error('加载数据源契约失败');
      setSourceView('list');
    } finally {
      setSourceLoading(false);
    }
  };

  const openNewSource = () => {
    setEditingSourceId('');
    setSourceFieldCount(0);
    sourceForm.resetFields();
    sourceForm.setFieldsValue({ enabled: true });
    setSourceView('detail');
  };

  const toggleFolder = (key: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const saveSource = async () => {
    let values: SourceForm;
    try {
      values = await sourceForm.validateFields();
    } catch {
      return;
    }
    setSourceSaving(true);
    try {
      let sourceId = editingSourceId;
      if (sourceId === '') {
        const created = await createReportSource({
          name: values.name,
          description: values.description,
          folder: values.folder ?? '',
          endpoint: values.endpoint,
          api_name: values.api_name,
          app_key_env: values.app_key_env,
          signature_env: values.signature_env,
          x_date_env: values.x_date_env ?? '',
          enabled: values.enabled,
        });
        sourceId = created.id;
      }
      const saved = await saveReportSourceContract(sourceId, {
        source_id: sourceId,
        name: values.name,
        description: values.description,
        folder: values.folder ?? '',
        endpoint: values.endpoint,
        api_name: values.api_name,
        app_key_env: values.app_key_env,
        signature_env: values.signature_env,
        x_date_env: values.x_date_env ?? '',
        api_example: values.api_example,
        response_example: values.response_example,
        hive_table: values.hive_table,
        hive_ddl: values.hive_ddl,
        hive_example: values.hive_example,
        enabled: values.enabled,
        fields: [],
      });
      setEditingSourceId(sourceId);
      setSourceFieldCount(saved.fields.length);
      await loadSources();
      message.success(`数据源契约已保存，共解析 ${saved.fields.length} 个字段`);
    } catch {
      message.error('保存数据源失败');
    } finally {
      setSourceSaving(false);
    }
  };

  return (
    <Modal
      title={sourceView === 'list' ? '选择数据源' : '数据源详情'}
      width={sourceView === 'list' ? 780 : 920}
      open={open}
      onCancel={onClose}
      onOk={sourceView === 'detail' ? () => void saveSource() : undefined}
      okText="保存并解析字段"
      cancelText="关闭"
      footer={sourceView === 'list' ? null : undefined}
      confirmLoading={sourceSaving}
      okButtonProps={{ disabled: sourceLoading }}
      styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
    >
      {sourceView === 'list' ? (
        <Spin spinning={catalogLoading}>
          <div className={styles.sourcePicker}>
            <div className={styles.sourcePickerIntro}>
              <div><strong>数据源目录</strong><p>按文件夹归集业务数据源，再查看接口、字段和 Hive 配置。</p></div>
              <Button type="primary" icon={<PlusOutlined />} onClick={openNewSource}>新增数据源</Button>
            </div>
            {sources.length > 0 ? <>
              <div className={styles.sourceSearch}>
                <Input allowClear size="large" prefix={<SearchOutlined />} value={sourceCatalogQuery} onChange={(event) => setSourceCatalogQuery(event.target.value)} placeholder="查询数据源名称、中文用途或 API Name" aria-label="查询数据源" />
                <span>{filteredSources.length} / {sources.length}</span>
              </div>
              {filteredSources.length > 0 ? <div className={styles.sourceFolderList}>{folderGroups.map((group) => {
                const expanded = sourceCatalogQuery.trim().length > 0 || expandedFolders.has(group.key);
                return (
                  <section key={group.key} className={styles.sourceFolderGroup} aria-label={`${group.label}文件夹`}>
                    <button type="button" className={styles.sourceFolderHead} aria-expanded={expanded} onClick={() => toggleFolder(group.key)}>
                      <span className={styles.sourceFolderIcon}><FolderOpenOutlined /></span>
                      <strong>{group.label}</strong>
                      <span className={styles.sourceFolderCount}>{group.sources.length} 个数据源</span>
                      <RightOutlined className={styles.sourceFolderArrow} />
                    </button>
                    {expanded ? (
                      <div className={styles.sourceFolderBody}>
                        <div className={styles.sourceGrid}>
                          {group.sources.map((source) => (
                            <ReportSourceCard key={source.id} source={source} active={open} onOpen={(id) => void openSourceDetail(id)} />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </section>
                );
              })}</div> : <div className={styles.sourceEmpty}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的数据源" /><Button onClick={() => setSourceCatalogQuery('')}>清除查询</Button></div>}
            </> : <div className={styles.sourceEmpty}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有数据源" /><Button type="primary" onClick={openNewSource}>创建第一个数据源</Button></div>}
          </div>
        </Spin>
      ) : (
        <Spin spinning={sourceLoading}>
          <div className={styles.sourceDetailHead}>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => setSourceView('list')}>返回数据源</Button>
            <div><span className={styles.sourceDetailIcon}><DatabaseOutlined /></span><div><strong>{editingSourceId ? sourceForm.getFieldValue('name') || '数据源详情' : '新增数据源'}</strong><p>{editingSourceId ? '编辑用途、接口与字段调用契约' : '配置一个新的业务数据接口'}</p></div></div>
          </div>
          <Form form={sourceForm} layout="vertical" initialValues={{ enabled: true }}>
            <section className={styles.sourceFormSection}>
              <div className={styles.sourceFormSectionTitle}><strong>基础信息</strong><span>用于列表识别和运行时连接</span></div>
              <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input placeholder="epower_platform.price_sensitive" /></Form.Item>
              <Form.Item name="description" label="中文用途说明" rules={[{ required: true, message: '请填写数据源用途' }]}><Input.TextArea rows={2} placeholder="例如：充电用户价敏标签，提供 DUID 粒度的价敏得分与分层结果" /></Form.Item>
              <Form.Item name="folder" label="所属文件夹" extra="按业务需求分组，例如：价敏标签；可直接输入新文件夹名称，留空表示未分组">
                <AutoComplete options={folderOptions} placeholder="例如：价敏标签" allowClear filterOption />
              </Form.Item>
              <Form.Item name="endpoint" label="网关地址" rules={[{ required: true }]}><Input placeholder="http://10.x.x.x:8000" /></Form.Item>
              <Form.Item name="api_name" label="API Name" rules={[{ required: true }]}><Input placeholder="price_sensitive" /></Form.Item>
              <div className={styles.sourceFormGrid}>
                <Form.Item name="app_key_env" label="App Key 环境变量" rules={[{ required: true }]}><Input placeholder="REPORT_PRICE_APP_KEY" /></Form.Item>
                <Form.Item name="signature_env" label="签名环境变量" rules={[{ required: true }]}><Input placeholder="REPORT_PRICE_SIGN" /></Form.Item>
              </div>
              <Form.Item name="x_date_env" label="签名日期环境变量（仅联调）" extra="静态签名回放时填写；签名值本身不要粘贴到示例中"><Input placeholder="REPORT_PRICE_SIGN_DATE" /></Form.Item>
              <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
            </section>
            <details className={styles.sourceDisclosure}>
              <summary><span><strong>API 调用与返回</strong><small>脱敏后的 curl 和返回样例</small></span><em>展开</em></summary>
              <div className={styles.sourceDisclosureBody}>
                <Form.Item name="api_example" label="API 调用示例"><Input.TextArea rows={8} placeholder="粘贴脱敏后的 curl 示例" /></Form.Item>
                <Form.Item name="response_example" label="API 返回样例"><Input.TextArea rows={8} placeholder="粘贴返回 JSON 样例" /></Form.Item>
              </div>
            </details>
            <details className={styles.sourceDisclosure}>
              <summary><span><strong>Hive 表与字段契约</strong><small>当前已解析 {sourceFieldCount} 个可调用字段</small></span><em>展开</em></summary>
              <div className={styles.sourceDisclosureBody}>
                <Form.Item name="hive_table" label="Hive 表名称" rules={[{ required: true }]}><Input placeholder="epower_platform.price_sensitive" /></Form.Item>
                <Form.Item name="hive_ddl" label="Hive 建表语句" extra="保存时自动解析可调用字段" rules={[{ required: true }]}><Input.TextArea rows={12} placeholder="粘贴 CREATE TABLE 语句" /></Form.Item>
                <Form.Item name="hive_example" label="SQL 调用示例"><Input.TextArea rows={6} placeholder="SELECT ..." /></Form.Item>
              </div>
            </details>
          </Form>
        </Spin>
      )}
    </Modal>
  );
};

export default DataSourceManagerModal;

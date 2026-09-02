import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonalReport } from '@/types/personalReport';

vi.mock('@/api/personalReport', () => ({
  getPersonalReport: vi.fn(),
  listPersonalReports: vi.fn(),
  updatePersonalReport: vi.fn(),
}));

import * as personalReportApi from '@/api/personalReport';
import { resetPersonalReportStore, usePersonalReportStore } from '../personalReportStore';

const report: PersonalReport = {
  id: 'report-1',
  owner_user_id: 'user-1',
  conversation_id: 'conversation-1',
  title: '经营分析',
  description: '真实数据报表',
  status: 'saved',
  style_preset: 'glass',
  style_prompt: '',
  query: { fieldList: [] },
  document: { sections: [] },
  provenance: { source_name: 'price_sensitive' },
  revision: 1,
  created_at: '2026-08-28T00:00:00Z',
  updated_at: '2026-08-28T00:00:00Z',
};

describe('personalReportStore', () => {
  beforeEach(() => {
    resetPersonalReportStore();
    usePersonalReportStore.setState({ reports: [report], activeReport: report });
    vi.clearAllMocks();
  });

  it('persists a style change and replaces the active report with the saved revision', async () => {
    const updated = { ...report, style_preset: 'business', revision: 2 };
    vi.mocked(personalReportApi.updatePersonalReport).mockResolvedValue(updated);

    await usePersonalReportStore.getState().updateStyle('business');

    expect(personalReportApi.updatePersonalReport).toHaveBeenCalledWith(
      report.id,
      expect.objectContaining({ style_preset: 'business', document: report.document }),
    );
    expect(usePersonalReportStore.getState()).toMatchObject({
      activeReport: updated,
      reports: [updated],
      saving: false,
      error: null,
    });
  });

  it('keeps the loaded report visible when style saving fails', async () => {
    vi.mocked(personalReportApi.updatePersonalReport).mockRejectedValue(new Error('保存超时'));

    await usePersonalReportStore.getState().updateStyle('business');

    expect(usePersonalReportStore.getState()).toMatchObject({
      activeReport: report,
      reports: [report],
      saving: false,
      error: '保存超时',
    });
  });
});

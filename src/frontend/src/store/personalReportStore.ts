import { create } from 'zustand';
import { getPersonalReport, listPersonalReports, updatePersonalReport } from '@/api/personalReport';
import type { PersonalReport, PersonalReportInput } from '@/types/personalReport';

interface PersonalReportState {
  reports: PersonalReport[];
  activeReport: PersonalReport | null;
  workspaceOpen: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  loadReports: () => Promise<void>;
  selectReport: (report: PersonalReport | null) => void;
  openWorkspace: (reportId?: string, conversationId?: string) => Promise<void>;
  closeWorkspace: () => void;
  updateStyle: (stylePreset: string) => Promise<void>;
  upsertLocal: (report: PersonalReport) => void;
}

function byUpdatedAt(rows: PersonalReport[]): PersonalReport[] {
  return [...rows].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

function toInput(report: PersonalReport, stylePreset = report.style_preset): PersonalReportInput {
  return {
    conversation_id: report.conversation_id,
    message_id: report.message_id,
    data_source_id: report.data_source_id,
    title: report.title,
    description: report.description,
    status: report.status,
    style_preset: stylePreset,
    style_prompt: report.style_prompt,
    query: report.query,
    document: report.document,
    provenance: report.provenance,
  };
}

export const usePersonalReportStore = create<PersonalReportState>((set, get) => ({
  reports: [],
  activeReport: null,
  workspaceOpen: false,
  loading: false,
  saving: false,
  error: null,

  loadReports: async () => {
    set({ loading: true, error: null });
    try {
      const reports = byUpdatedAt(await listPersonalReports());
      const activeId = get().activeReport?.id;
      const activeReport = reports.find((report) => report.id === activeId) ?? reports[0] ?? null;
      set({ reports, activeReport, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '个人报表加载失败',
      });
    }
  },

  selectReport: (activeReport) => set({ activeReport }),

  openWorkspace: async (reportId, conversationId) => {
    set({ workspaceOpen: true, error: null });
    if (!reportId) {
      if (get().reports.length === 0) await get().loadReports();
      const candidates = get().reports.filter((report) =>
        !conversationId || !report.conversation_id || report.conversation_id === conversationId,
      );
      const current = get().activeReport;
      const belongsToConversation = current && (
        !conversationId || !current.conversation_id || current.conversation_id === conversationId
      );
      set({ activeReport: belongsToConversation ? current : candidates[0] ?? null });
      return;
    }
    const cached = get().reports.find((report) => report.id === reportId);
    if (cached) {
      set({ activeReport: cached });
      return;
    }
    set({ loading: true });
    try {
      const report = await getPersonalReport(reportId);
      set((state) => ({
        activeReport: report,
        reports: byUpdatedAt([report, ...state.reports.filter((item) => item.id !== report.id)]),
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : '个人报表加载失败',
      });
    }
  },

  closeWorkspace: () => set({ workspaceOpen: false }),

  updateStyle: async (stylePreset) => {
    const current = get().activeReport;
    if (!current || current.style_preset === stylePreset || get().saving) return;

    set({ saving: true, error: null });
    try {
      const report = await updatePersonalReport(current.id, toInput(current, stylePreset));
      set((state) => ({
        reports: byUpdatedAt([report, ...state.reports.filter((item) => item.id !== report.id)]),
        activeReport: report,
        saving: false,
      }));
    } catch (error) {
      set({
        saving: false,
        error: error instanceof Error ? error.message : '报表风格保存失败',
      });
    }
  },

  upsertLocal: (report) => set((state) => ({
    reports: byUpdatedAt([report, ...state.reports.filter((item) => item.id !== report.id)]),
    activeReport: state.activeReport?.id === report.id ? report : state.activeReport,
  })),
}));

export function resetPersonalReportStore() {
  usePersonalReportStore.setState({
    reports: [],
    activeReport: null,
    workspaceOpen: false,
    loading: false,
    saving: false,
    error: null,
  });
}

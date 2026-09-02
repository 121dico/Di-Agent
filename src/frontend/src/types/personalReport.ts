export type PersonalReportStatus = 'draft' | 'saved' | 'failed';

export interface PersonalReportSection {
  id: string;
  type: string;
  title?: string;
  data?: unknown;
}

export interface PersonalReportDocument {
  sections?: PersonalReportSection[];
  [key: string]: unknown;
}

export interface PersonalReportProvenance {
  source_name?: string;
  source_partition?: string;
  query_id?: string;
  queried_at?: string;
  duration_ms?: number;
  [key: string]: unknown;
}

export interface PersonalReport {
  id: string;
  owner_user_id: string;
  conversation_id?: string;
  message_id?: string;
  data_source_id?: string;
  title: string;
  description: string;
  status: PersonalReportStatus;
  style_preset: string;
  style_prompt: string;
  query: Record<string, unknown>;
  document: PersonalReportDocument;
  provenance: PersonalReportProvenance;
  revision: number;
  created_at: string;
  updated_at: string;
}

export type PersonalReportInput = Omit<
  PersonalReport,
  'id' | 'owner_user_id' | 'revision' | 'created_at' | 'updated_at'
>;

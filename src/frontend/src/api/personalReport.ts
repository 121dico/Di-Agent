import { del, get, post, put } from './client';
import type { PersonalReport, PersonalReportInput } from '@/types/personalReport';

export const listPersonalReports = () =>
  get<PersonalReport[] | null>('/api/personal-reports').then((rows) => rows ?? []);

export const getPersonalReport = (id: string) =>
  get<PersonalReport>(`/api/personal-reports/${id}`);

export const createPersonalReport = (body: PersonalReportInput) =>
  post<PersonalReport>('/api/personal-reports', body);

export const updatePersonalReport = (id: string, body: PersonalReportInput) =>
  put<PersonalReport>(`/api/personal-reports/${id}`, body);

export const deletePersonalReport = (id: string) =>
  del<{ deleted: boolean }>(`/api/personal-reports/${id}`);

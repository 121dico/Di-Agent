import { get } from './client';
import type { StationValidationResult } from '@/types/stationValidation';
import type { StationPeopleResult } from '@/types/stationPeople';
import type { StationScoreEvidenceResult } from '@/types/stationScoreEvidence';

export const queryStationValidation = (reportId: string, refresh = false) =>
  get<StationValidationResult>(`/api/reports/${reportId}/station-validation${refresh ? '?refresh=true' : ''}`);

export const queryStationPeople = (reportId: string, station: string, start: string, end: string, refresh = false) =>
  get<StationPeopleResult>(`/api/reports/${reportId}/station-people?${new URLSearchParams({ station, start, end, refresh: String(refresh) })}`);

export const queryStationScoreEvidence = (reportId: string, station: string, start: string, end: string, level: string, minDays: number) =>
  get<StationScoreEvidenceResult>(`/api/reports/${reportId}/station-score-evidence?${new URLSearchParams({ station, start, end, level, min_days: String(minDays) })}`);

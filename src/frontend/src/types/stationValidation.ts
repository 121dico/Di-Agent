export interface StationValidationDay {
  dt: string;
  station_id: string;
  station_name: string;
  users: number;
  levels: Record<string, number>;
}

export interface StationValidationResult {
  source_id: string;
  source_name: string;
  fetched_at: string;
  available_dates: string[];
  rows: StationValidationDay[];
}

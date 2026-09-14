export interface StationPeopleOverlap {
  users: number; new: number; returning: number; previous_week: number; same_level_week: number;
}
export interface StationPeopleResult {
  start: string; end: string; history_start: string; station_id: string; fetched_at: string;
  users: number; repeat_users: number; multi_day_users: number; cross_station_users: number;
  days: { dt: string; users: number; new: number; returning: number; previous: number; previous_week: number; previous_available: boolean; week_days_available: number; levels: Record<string, StationPeopleOverlap> }[];
  levels: Record<string, { users: number; once: number; twice: number; three_plus: number; multi_day: number; cross_station: number }>;
}

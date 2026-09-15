export interface StationScoreCase {
  duid: string;
  consumption_days: number;
  orders: number;
  first_date: string;
  last_date: string;
  label_date: string;
  level: string;
  status: 'matched' | 'unavailable';
  reason: string;
  fields: Record<string, string | number | boolean | null>;
  observed_contributions: { price: number | null; coupon: number | null; time: number | null };
}

export interface StationScoreEvidenceResult {
  station_id: string;
  start: string;
  end: string;
  level: string;
  min_days: number;
  candidate_count: number;
  limit: number;
  fetched_at: string;
  cases: StationScoreCase[];
}

import { get, post } from './client';

export interface DataConnection {
  kind: 'api' | 'hive' | 'datamap' | 'cooper';
  name: string;
  account: string;
  status: string;
  detail: string;
  source_count?: number;
}

export interface DataSessionIdentity { provider: string; account: string; user_id: string }

export interface HiveTable { name: string; description: string; permission: '有权限' | '无权限' | '检测失败' | '检测中' | '待核实' | '已添加'; permission_detail: string; query_enabled?: boolean }
export interface HiveCatalogSnapshot {
  state: 'scanning' | 'complete' | 'error';
  database_count: number; scanned_databases: number; discovered_tables: number;
  checked_tables: number; readable_tables: number; failed_databases: number;
  tables: Array<HiveTable & { query_enabled?: boolean }>;
  has_more: boolean; error?: string;
  notice?: string;
}

export interface APIConnectionStatus { id: string; name: string; account: string; status: string; detail: string }

export interface HiveReceipt {
  id: string;
  table_name: string;
  sql: string;
  rows: Array<Record<string, unknown>>;
  row_count: number;
  duration_ms: number;
  created_at: string;
}

export const listDataConnections = () => get<DataConnection[]>('/api/data/connections');
export const getDataSession = () => get<DataSessionIdentity>('/api/data/session');
export const listAPISourceStatuses = () => get<APIConnectionStatus[]>('/api/data/api/sources');
export const listHiveTables = () => get<HiveTable[]>('/api/data/hive/tables');
export const addHiveTable = (name: string) => post<HiveTable>('/api/data/hive/tables', { table_name: name });
export const listHiveCatalog = (search = '', recent: string[] = []) => {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (recent.length) params.set('recent', recent.slice(0, 20).join(','));
  return get<HiveCatalogSnapshot>(`/api/data/hive/catalog?${params}`);
};
export const probeHiveCatalogTable = (name: string) => get<HiveTable>(`/api/data/hive/catalog/probe?table=${encodeURIComponent(name)}`);
export const loginHive = (username: string, password: string) =>
  post<null>('/api/data/hive/login', { username, password });
export const runHiveQuery = (tableName: string, sql: string) =>
  post<HiveReceipt>('/api/data/hive/query', { table_name: tableName, sql });
export const listHiveReceipts = () => get<HiveReceipt[] | null>('/api/data/hive/receipts').then((rows) => rows ?? []);
export const getHiveReceipt = (id: string) => get<HiveReceipt>(`/api/data/hive/receipts/${encodeURIComponent(id)}`);

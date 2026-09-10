import { expect, it } from 'vitest';
import { loadSnapshotHistory, loadStoredSnapshotHistory } from './reportSnapshotHistory';
import type { ReportAnalyticsResult } from '@/types/report';

it('reuses retained days and only queries a newly available dt', async () => {
 const calls: string[]=[];
 const seed={data_date:'2026-07-28',start_date:'2026-07-28',end_date:'2026-07-28',trend:[{dt:'2026-07-28',total_user_count:10}],summary:{total_user_count:10}} as ReportAnalyticsResult;
 const query=async (_id:string,range:string,end?:string)=>{
  calls.push(`${range}:${end??''}`);
  if(range==='dates')return {available_dates:['2026-07-28','2026-07-29']} as ReportAnalyticsResult;
  return {...seed,data_date:end,trend:[{dt:end,total_user_count:11}],summary:{total_user_count:11}} as ReportAnalyticsResult;
 };
 let final:ReportAnalyticsResult|null=null;
 await loadSnapshotHistory(query,'r','all',[],result=>{final=result},()=>true,seed);
 expect(calls).toEqual(['dates:','1d:2026-07-29']);
 expect(final!.trend.map(point=>point.dt)).toEqual(['2026-07-28','2026-07-29']);
 expect(final!.summary.total_user_count).toBe(11);
});

it('shows saved history before checking dates and makes no per-day requests on revisit', async()=>{
 const calls:string[]=[];
 const publications:string[]=[];
 const saved={data_date:'2026-07-28',start_date:'2026-07-28',end_date:'2026-07-28',trend:[{dt:'2026-07-28'}],summary:{total_user_count:10}} as ReportAnalyticsResult;
 const query=async (_id:string,range:string)=>{
  calls.push(range);
  if(range==='saved')return saved;
  if(range==='dates') {expect(publications).toEqual(['2026-07-28']); return {available_dates:['2026-07-28']} as ReportAnalyticsResult;}
  throw new Error('unexpected daily request');
 };
 await loadStoredSnapshotHistory(query,'r','all',[],result=>{if(result)publications.push(result.data_date!)});
 expect(calls).toEqual(['saved','dates']);
});

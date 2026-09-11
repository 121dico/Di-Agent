import { expect, it } from 'vitest';
import { loadSnapshotHistory, loadStoredSnapshotHistory } from './reportSnapshotHistory';
import type { ReportAnalyticsResult } from '@/types/report';

it('does not flash an excluded-only saved snapshot or request its daily data', async () => {
 const published: ReportAnalyticsResult[] = [];
 const calls: string[] = [];
 await expect(loadStoredSnapshotHistory(async (_id, range) => {
  calls.push(range);
  return range === 'saved'
   ? { data_date: '2026-07-28', start_date: '2026-07-28', trend: [{dt:'2026-07-28'}] } as ReportAnalyticsResult
   : { available_dates: ['2026-07-28'] } as ReportAnalyticsResult;
 }, 'r', 'all', [], result => { if(result)published.push(result); })).rejects.toThrow('没有可用的 dt');
 expect(published).toEqual([]);
 expect(calls).toEqual(['saved','dates']);
});

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
 expect(final!.trend.map(point=>point.dt)).toEqual(['2026-07-29']);
 expect(final!.summary.total_user_count).toBe(11);
});

it('shows saved history before checking dates and makes no per-day requests on revisit', async()=>{
 const calls:string[]=[];
 const publications:string[]=[];
 const saved={data_date:'2026-07-29',start_date:'2026-07-28',end_date:'2026-07-29',trend:[{dt:'2026-07-28'},{dt:'2026-07-29'}],summary:{total_user_count:10}} as ReportAnalyticsResult;
 const query=async (_id:string,range:string)=>{
  calls.push(range);
  if(range==='saved')return saved;
  if(range==='dates') {expect(publications).toEqual(['2026-07-29']); return {available_dates:['2026-07-28','2026-07-29']} as ReportAnalyticsResult;}
  throw new Error('unexpected daily request');
 };
 await loadStoredSnapshotHistory(query,'r','all',[],result=>{if(result){
  expect(result.start_date).toBe('2026-07-29');
  expect(result.trend.map(point=>point.dt)).toEqual(['2026-07-29']);
  publications.push(result.data_date!);
 }});
 expect(calls).toEqual(['saved','dates']);
});

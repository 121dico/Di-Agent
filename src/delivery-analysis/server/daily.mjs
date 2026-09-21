import {stageBuckets,validatePartition} from './cumulative.mjs';
// 日口径整体独立去重，不能把两个来源组相加当作独立用户。
export async function buildDailyUnion({query,kind,conditions,dimensions,day,source,control}){
  if(kind!=='coupon')return null;
  const rows=(await stageBuckets(query,kind,conditions,[day])).map(r=>({...r,date:r[day]}));
  if(control){
    const expected=control.rows.map(r=>r.date);
    if(rows.length!==expected.length||new Set(rows.map(r=>r.date)).size!==rows.length||rows.some(r=>!expected.includes(r.date)))throw new Error('daily date coverage mismatch');
    for(const row of rows){
      const independent=control.rows.find(r=>r.date===row.date);
      if(row.users!==independent.users)throw new Error('daily users mismatch');
      const grouped=source.rows.filter(r=>r.date===row.date);
      for(const metric of ['coupon','full','repurchase','coupon_repurchase','full_repurchase']){
        const sum=grouped.reduce((n,r)=>n+r[metric],0);
        const byGroup=new Map();for(const r of grouped)byGroup.set(r.group_type,(byGroup.get(r.group_type)||0)+r[metric]);
        if(row[metric]>sum||[...byGroup.values()].some(n=>n>row[metric])||row[metric]<sum-independent.overlapUsers)throw new Error('daily stage coverage mismatch');
      }
    }
  }
  const slices={};
  for(const dimension of dimensions){
    const values=(await stageBuckets(query,kind,conditions,[day,dimension])).map(r=>({...r,date:r[day],value:r[dimension]??'未知'}));
    const exclusive={};
    for(const row of rows)exclusive[row.date]=validatePartition(kind,values.filter(v=>v.date===row.date),row);
    slices[dimension]={rows:values,exclusive};
  }
  return {rows,dimensions:slices,note:'各日与各阶段由源表按 DUID 独立去重；来源组之间的重复用户仅计一次。'};
}

// 预计算所有已发布日期区间，仅保存聚合；页面切换自定义周期不扫描上游明细。
export async function buildPeriodFunnels({query,kind,conditions,dates,cumulative,day}){
  if(dates.length>45)throw new Error('period precomputation exceeds bound');
  const periods={},jobs=[];
  for(let i=0;i<dates.length;i++)for(let j=i;j<dates.length;j++)jobs.push([dates[i],dates[j]]);
  let cursor=0,failed=false;
  async function worker(){
    try{while(!failed&&cursor<jobs.length){
      const [start,end]=jobs[cursor++],key=start+'/'+end;
      if(start===dates[0]&&end===dates.at(-1)){periods[key]=cumulative.scopes.map(s=>({group:s.group,summary:s.summary}));continue;}
      const filters=[...conditions,{name:day,operator:'GEQ',value:start},{name:day,operator:'LEQ',value:end}];
      const overall=(await stageBuckets(query,kind,filters,[]))[0],groups=await stageBuckets(query,kind,filters,['group_type']);
      validatePartition(kind,groups,overall);
      periods[key]=[{group:'all',summary:overall},...groups.map(r=>({group:r.group_type,summary:r}))];
    }}catch(error){failed=true;throw error;}
  }
  const settled=await Promise.allSettled([worker(),worker()]);
  const failure=settled.find(r=>r.status==='rejected');if(failure)throw failure.reason;
  return {dates,periods,note:'在所选日期范围内按 DUID 独立去重，不能将分日人数相加。'};
}

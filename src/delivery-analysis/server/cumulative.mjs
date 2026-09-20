const count=[{name:'duid',aggregation:'COUNT_DISTINCT',alias:'users'}];
const yes=name=>({name,operator:'EQ',value:1});
const stages={
  coupon:{users:[],coupon:[yes('is_coupon')],full:[yes('is_full_coupon')],repurchase:[yes('is_repurchase_7d')],coupon_repurchase:[yes('is_coupon'),yes('is_repurchase_7d')],full_repurchase:[yes('is_full_coupon_repurchase_7d')]},
  effect:{users:[],achieved:[yes('achieved_flag')]},
};
function finalize(kind,row) {
  const result={...row};
  for(const key of Object.keys(stages[kind])) {
    const n=Number(row[key]??0);
    if(!Number.isSafeInteger(n)||n<0)throw new Error('invalid cumulative count');
    result[key]=n;
  }
  result.eligible=kind==='coupon'?result.coupon:result.users;
  result.success=kind==='coupon'?result.coupon_repurchase:result.achieved;
  if(result.success>result.eligible || result.eligible>result.users)throw new Error('invalid cumulative stages');
  if(kind==='coupon' && (result.full>result.coupon || result.full_repurchase>Math.min(result.full,result.coupon_repurchase) || result.repurchase>result.users || result.coupon_repurchase>result.repurchase))throw new Error('invalid cumulative coupon subsets');
  result.unmet=result.eligible-result.success;
  result.rate=result.eligible>0?result.success/result.eligible:null;
  return result;
}

function validatePartition(kind,rows,total) {
  const exclusive=rows.reduce((sum,r)=>sum+r.users,0)===total.users;
  for(const metric of Object.keys(stages[kind])) {
    const sum=rows.reduce((value,r)=>value+r[metric],0);
    if(rows.some(r=>r[metric]>total[metric]) || sum<total[metric] || (exclusive && sum!==total[metric]))throw new Error('incomplete cumulative partition');
  }
  return exclusive;
}

// 每个阶段在源表直接去重；总量独立查询，不能将日期、分组或变化标签的桶直接相加。
export async function buildCumulative({query,kind,conditions,dimensions,dates}) {
  async function buckets(groups) {
    const result=new Map();
    for(const [metric,filters] of Object.entries(stages[kind])) {
      const rows=await query(kind,groups,[...conditions,...filters],count);
      for(const row of rows) {
        if(row.users===null || row.users===undefined || !Number.isSafeInteger(Number(row.users)) || Number(row.users)<0)throw new Error('invalid cumulative count');
        const key=JSON.stringify(groups.map(g=>row[g]));
        if(!result.has(key))result.set(key,Object.fromEntries(groups.map(g=>[g,row[g]])));
        if(metric!=='users' && !Object.hasOwn(result.get(key),'users'))throw new Error('cumulative subset outside population');
        result.get(key)[metric]=row.users;
      }
    }
    if(!groups.length && !result.size)return [finalize(kind,{})];
    return [...result.values()].map(row=>finalize(kind,row));
  }
  const overall=(await buckets([]))[0],groupRows=await buckets(['group_type']);
  validatePartition(kind,groupRows,overall);
  const scopes=[{group:'all',summary:overall,dimensions:{}},...groupRows.map(row=>({group:row.group_type,summary:row,dimensions:{}}))];
  for(const dimension of dimensions) {
    const overallRows=await buckets([dimension]);
    const byGroup=await buckets(['group_type',dimension]);
    for(const scope of scopes) {
      const rows=(scope.group==='all'?overallRows:byGroup.filter(r=>r.group_type===scope.group)).map(r=>({...r,value:r[dimension]??'未知（空值）'}));
      scope.dimensions[dimension]={rows,exclusive:validatePartition(kind,rows,scope.summary)};
    }
  }
  return {version:1,kind,startDate:dates[0],endDate:dates.at(-1),scopes,
    groupOverlap:groupRows.reduce((s,r)=>s+r.users,0)-overall.users,
    metric:kind==='coupon'?'累计领券后7日复购率':'期间曾达标人数占比',
    note:kind==='coupon'?'在已提供进组日期内按 DUID 去重；复购沿用每次入组后第1–7天标记，分子要求同次入组领券且复购。':'在已提供统计日期内按 DUID 去重；任一日 achieved_flag=1 计为期间曾达标，非活动新增订单或因果增量。',
  };
}

export function selectCumulative(cumulative,{group='all',dimension='charge_life_cycle'}={}) {
  if(!cumulative)return null;
  const scope=cumulative.scopes.find(s=>s.group===group);
  if(!scope || !Object.hasOwn(scope.dimensions,dimension))throw new Error('invalid cumulative selection');
  const {scopes,...metadata}=cumulative;
  return {...metadata,selectedGroup:group,dimension,summary:scope.summary,
    distribution:scope.dimensions[dimension].rows.slice().sort((a,b)=>b.users-a.users),
    exclusiveDimension:scope.dimensions[dimension].exclusive,
    groupSummary:scopes.filter(s=>s.group!=='all').map(s=>({group:s.group,...s.summary})),
  };
}

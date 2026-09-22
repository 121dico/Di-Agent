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

export function validatePartition(kind,rows,total) {
  const exclusive=rows.reduce((sum,r)=>sum+r.users,0)===total.users;
  for(const metric of Object.keys(stages[kind])) {
    const sum=rows.reduce((value,r)=>value+r[metric],0);
    if(rows.some(r=>r[metric]>total[metric]) || sum<total[metric] || (exclusive && sum!==total[metric]))throw new Error('incomplete cumulative partition');
  }
  return exclusive;
}

export async function stageBuckets(query,kind,conditions,groups) {
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

// 每个阶段在源表直接去重；总量独立查询，不能将日期、分组或变化标签的桶直接相加。
export async function buildCumulative({query,kind,conditions,dimensions,dates}) {
  const buckets=groups=>stageBuckets(query,kind,conditions,groups);
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
  // 只有独立去重验证为互斥的标签可相加联合桶；变化标签继续单独查询，绝不推算交叉人数。
  const jointKeys=dimensions.filter(k=>scopes.every(scope=>scope.dimensions[k].exclusive));
  if(jointKeys.length>1){
    const queryKeys=[...jointKeys].sort((a,b)=>scopes[0].dimensions[b].rows.length-scopes[0].dimensions[a].rows.length);
    for(const scope of scopes){
      const scopedConditions=[...conditions,...(scope.group==='all'?[]:[{name:'group_type',operator:'EQ',value:scope.group}])];
      const rows=await stageBuckets(query,kind,scopedConditions,queryKeys);
      if(!validatePartition(kind,rows,scope.summary))throw new Error('cumulative joint labels overlap');
      for(const key of jointKeys){
        const actual=new Map();
        for(const row of rows){const value=String(row[key]??'未知（空值）');if(!actual.has(value))actual.set(value,[]);actual.get(value).push(row);}
        const expected=scope.dimensions[key].rows;
        if(actual.size!==expected.length)throw new Error('cumulative joint marginal mismatch');
        for(const row of expected){const values=actual.get(String(row.value));if(!values||!validatePartition(kind,values,row))throw new Error('cumulative joint marginal mismatch');}
      }
      scope.cube={keys:jointKeys,rows:rows.map(row=>({...row,...Object.fromEntries(jointKeys.map(key=>[key,String(row[key]??'未知（空值）')]))}))};
    }
  }
  return {version:1,kind,startDate:dates[0],endDate:dates.at(-1),scopes,
    groupOverlap:groupRows.reduce((s,r)=>s+r.users,0)-overall.users,
    metric:kind==='coupon'?'累计领券后7日复购率':'期间曾达标人数占比',
    note:kind==='coupon'?'在已提供进组日期内按 DUID 去重；复购沿用每次入组后第1–7天标记，分子要求同次入组领券且复购。':'在已提供统计日期内按 DUID 去重；任一日 achieved_flag=1 计为期间曾达标，非活动新增订单或因果增量。',
  };
}

export function selectCumulative(cumulative,{group='all',dimension='charge_life_cycle',breakdown}={}) {
  if(!cumulative)return null;
  const scope=cumulative.scopes.find(s=>s.group===group);
  if(!scope || !Object.hasOwn(scope.dimensions,dimension))throw new Error('invalid cumulative selection');
  const {scopes,...metadata}=cumulative;
  return {...metadata,selectedGroup:group,dimension,summary:scope.summary,
    distribution:scope.dimensions[dimension].rows.slice().sort((a,b)=>b.users-a.users),
    exclusiveDimension:scope.dimensions[dimension].exclusive,
    breakdown:selectBreakdown(cumulative.kind,scope,breakdown||{dimensions:[dimension],filters:[]}),
    groupSummary:scopes.filter(s=>s.group!=='all').map(s=>({group:s.group,...s.summary})),
  };
}

// 对已发布互斥联合桶做内存筛选；统计只读聚合，不在点击时查询上游。
function selectBreakdown(kind,scope,input){
  if(typeof input==='string'){try{input=JSON.parse(input);}catch{throw new Error('invalid cumulative breakdown');}}
  const dimensions=input?.dimensions,filters=input?.filters;
  if(!Array.isArray(dimensions)||!Array.isArray(filters)||!dimensions.length||dimensions.length+filters.length>3)throw new Error('invalid cumulative breakdown');
  const keys=[...dimensions,...filters.map(f=>f?.dimension)];
  if(new Set(keys).size!==keys.length||keys.some(k=>typeof k!=='string'||!Object.hasOwn(scope.dimensions,k))||filters.some(f=>typeof f.value!=='string'||f.value.length>300))throw new Error('invalid cumulative breakdown');
  const availableDimensions=scope.cube?.keys||[];
  let rows,summary;
  if(!filters.length&&dimensions.length===1){
    rows=scope.dimensions[dimensions[0]].rows.map(r=>({...r,values:[String(r.value)]}));summary=scope.summary;
  }else{
    if(keys.some(k=>!availableDimensions.includes(k)))return {status:'missing',dimensions,filters,availableDimensions,rows:[],summary:null,note:'当前组合尚无可核验的互斥联合聚合；变化标签不能与其他维度推算组合。'};
    const selected=scope.cube.rows.filter(row=>filters.every(f=>row[f.dimension]===f.value));
    const sum=items=>finalize(kind,Object.fromEntries(Object.keys(stages[kind]).map(k=>[k,items.reduce((n,r)=>n+r[k],0)])));
    summary=sum(selected);const buckets=new Map();
    for(const row of selected){const values=dimensions.map(k=>row[k]),key=JSON.stringify(values);if(!buckets.has(key))buckets.set(key,{values,rows:[]});buckets.get(key).rows.push(row);}
    rows=[...buckets.values()].map(b=>({...sum(b.rows),values:b.values}));
  }
  const exclusive=keys.every(k=>scope.dimensions[k].exclusive);
  return {status:'available',dimensions,filters,availableDimensions,summary,exclusive,baseline:scope.summary,
    rows:rows.map(r=>({...r,value:r.values.join(' × '),share:summary.users?r.users/summary.users:null,overallShare:scope.summary.users?r.users/scope.summary.users:null,delta:Number.isFinite(r.rate)&&Number.isFinite(scope.summary.rate)?r.rate-scope.summary.rate:null})).sort((a,b)=>b.users-a.users||a.value.localeCompare(b.value,'zh-CN'))};
}

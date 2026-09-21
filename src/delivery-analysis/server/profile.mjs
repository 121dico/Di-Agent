// 仅保存同快照联合桶；交叉人数不能用单维边际比例相乘。
const label=value=>String(value??'未知');
const key=values=>JSON.stringify(values);
export async function buildProfileCube({query,kind,conditions,source,keys,day}) {
  const rows=[];
  // 网关分页按首个分组键拆分，先用枚举多的维度减少递归请求。
  const queryKeys=[...keys].sort((a,b)=>new Set(source.dimensions[b].map(r=>r.value)).size-new Set(source.dimensions[a].map(r=>r.value)).size);
  console.info('delivery.profile.start',kind);
  const scopes=new Map(source.rows.map(r=>[key([day?r.date:null,r.group_type]),r]));
  for(const scope of scopes.values()) {
    const filters=[...conditions,{name:'group_type',operator:scope.group_type==null?'IS_NULL':'EQ',...(scope.group_type==null?{}:{value:scope.group_type})},...(day?[{name:day,operator:'EQ',value:scope.date}]:[])];
    const buckets=await query(kind,queryKeys,filters,[{name:'duid',aggregation:'COUNT_DISTINCT',alias:'users'},{name:'duid',aggregation:'COUNT',alias:'records'}]);
    console.info('delivery.profile.scope',kind,day?scope.date:'snapshot',buckets.length);
    for(const r of buckets){
      if(!Number.isSafeInteger(Number(r.users))||Number(r.users)<0||Number(r.users)!==Number(r.records))throw new Error('invalid joint grain');
      rows.push({...Object.fromEntries(keys.map(k=>[k,label(r[k])])),group_type:scope.group_type,...(day?{date:scope.date}:{}),users:Number(r.users),records:Number(r.records)});
    }
  }
  // 每个维度、日期、组别都与单维统计逐桶对账，失败不发布。
  for(const dimension of keys){
    const aggregate=items=>{
      const result=new Map();
      for(const r of items){const k=key([day?r.date:null,r.group_type,label(r.value??r[dimension])]);result.set(k,(result.get(k)||0)+r.users);}
      return result;
    };
    const actual=aggregate(rows),expected=aggregate(source.dimensions[dimension]);
    if(actual.size!==expected.size||[...expected].some(([k,n])=>actual.get(k)!==n))throw new Error('joint marginal mismatch');
  }
  console.info('delivery.profile.complete',kind,rows.length);
  return {keys,rows};
}

export function selectProfile(source,{dimensions,group,date,hasAudience}) {
  if(!Array.isArray(dimensions)||dimensions.length<1||dimensions.length>3||new Set(dimensions).size!==dimensions.length||dimensions.some(k=>!Object.hasOwn(source.dimensions,k)))throw new Error('invalid profile dimensions');
  const scoped=rows=>rows.filter(r=>(hasAudience||r.date===date)&&(group==='all'||r.group_type===group));
  const cube=source.profileCube;
  if(dimensions.length>1&&(!cube||dimensions.some(k=>!cube.keys.includes(k))))return {status:'missing',dimensions,rows:[],total:null,basis:'joint_snapshot'};
  const values=new Map();
  const input=dimensions.length===1?scoped(source.dimensions[dimensions[0]]).map(r=>({values:[label(r.value)],users:r.users})):scoped(cube.rows).map(r=>({values:dimensions.map(k=>label(r[k])),users:r.users}));
  for(const r of input){const k=key(r.values);if(!values.has(k))values.set(k,{values:r.values,users:0});values.get(k).users+=r.users;}
  const rows=[...values.values()].sort((a,b)=>b.users-a.users||key(a.values).localeCompare(key(b.values),'zh-CN'));
  const total=rows.reduce((sum,r)=>sum+r.users,0),parents=new Map();
  for(const r of rows){const k=key(r.values.slice(0,-1));parents.set(k,(parents.get(k)||0)+r.users);}
  return {status:'available',basis:dimensions.length>1?'joint_snapshot':'single_snapshot',dimensions,total,rows:rows.map(r=>({...r,share:total?r.users/total:null,parentShare:parents.get(key(r.values.slice(0,-1)))?r.users/parents.get(key(r.values.slice(0,-1))):null}))};
}

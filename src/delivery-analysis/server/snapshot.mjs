export const DIMENSIONS = {
  charge_life_cycle: '生命周期', charge_freq_type: '充电频次',
  charge_duid_role_name_v2_type: '用户身份', member_status: '会员状态',
  city_name: '城市', city_fenkuang: '城市分框', charge_region: '战区',
};

// 按已验证的同一进组日或统计日汇总；跨日人数和滚动订单均不可相加。
export function summarize(kind, rows) {
  const total = {};
  for (const key of ['users','records','coupon','full','repurchase','coupon_repurchase','full_repurchase','axc','charge','achieved','unmet']) {
    total[key] = rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  }
  const ratio = (a,b) => b > 0 ? a / b : null;
  if (kind === 'coupon') {
    total.rate = ratio(total.coupon_repurchase, total.coupon);
    total.overallRate = ratio(total.repurchase, total.users);
    total.unmet = total.coupon - total.coupon_repurchase;
    total.eligible = total.coupon;
  } else {
    total.rate = ratio(total.axc, total.charge);
    total.eligible = total.users;
  }
  return total;
}

const SOURCE_NAMES={coupon:'ads_delivery_coupon_funnel_di',effect:'ads_delivery_user_effect_di',audience:'ads_delivery_audience_snapshot_di'};
const FLAGS=['is_coupon','is_full_coupon','is_repurchase_7d'];
const field=(name,aggregation,alias)=>({name,...(aggregation?{aggregation,alias}: {})});
const filter=(name,value)=>({name,operator:'EQ',value});
const finite=(value)=>{const n=Number(value);if(value===null || value===undefined || !Number.isFinite(n) || n<0)throw new Error('invalid aggregate');return n;};

function normalize(kind,row) {
  const users=finite(row.users),records=finite(row.records);
  if(users!==records) throw new Error('duplicate source grain');
  const out={...row,users,records};
  if(kind==='coupon') {
    for(const flag of FLAGS)if(![0,1].includes(Number(row[flag])))throw new Error('invalid coupon flag');
    const coupon=Number(row.is_coupon),full=Number(row.is_full_coupon),repurchase=Number(row.is_repurchase_7d);
    if(full>coupon)throw new Error('invalid coupon stages');
    Object.assign(out,{coupon:users*coupon,full:users*full,repurchase:users*repurchase,coupon_repurchase:users*coupon*repurchase,full_repurchase:users*full*repurchase});
  } else if(kind==='effect') {
    for(const key of ['axc','charge','achieved','unmet'])out[key]=finite(row[key]);
    if(out.achieved+out.unmet!==users)throw new Error('invalid achievement coverage');
  }
  return out;
}

export async function buildSnapshot(gateway) {
  gateway.evidence=[];
  const contracts=await gateway.contracts();
  const sources={};
  for(const [kind,name] of Object.entries(SOURCE_NAMES)) {
    const source=contracts.find(s=>s.name===`epower_platform.${name}`);
    if(!source)throw new Error('required source unavailable');
    sources[kind]=source;
  }
  async function query(kind,groups,conditions,metrics=[]) {
    const source=sources[kind];
    const fields=[...groups.map(name=>field(name)),...metrics];
    for(const selected of fields) {
      const declared=source.fields.find(f=>f.name===selected.name);
      if(!declared || !declared.capabilities.includes(selected.aggregation?'aggregate':'select')) throw new Error('field not allowed');
    }
    return gateway.query({source_id:source.source_id,fields,filters:conditions,group_by:groups,order_by:groups[0]});
  }
  const partitions={};
  for(const kind of Object.keys(sources)) {
    const rows=await query(kind,['dt'],[]);
    const dates=rows.map(r=>r.dt).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if(!dates.length)throw new Error('no source partition');
    partitions[kind]=dates.at(-1);
  }
  const counts=[field('duid','COUNT_DISTINCT','users'),field('duid','COUNT','records')];
  const tasks=[];
  for(const kind of ['coupon','effect']) {
    const day=kind==='coupon'?'entry_dt':'stat_dt';
    const identity=kind==='coupon'?filter('source_task_id','184765378'):filter('crowd_id','crowd_axc_low_freq');
    const conditions=[filter('dt',partitions[kind]),identity];
    const metrics=kind==='coupon'?counts:[...counts,field('axc_ord_cnt_30d','SUM','axc'),field('chg_ord_cnt_30d','SUM','charge'),field('achieved_flag','SUM','achieved'),field('unmet_flag','SUM','unmet')];
    const groups=[day,'group_type',...(kind==='coupon'?FLAGS:[])];
    const rows=(await query(kind,groups,conditions,metrics)).map(r=>normalize(kind,{...r,date:r[day]}));
    const dates=[...new Set(rows.map(r=>r.date))].sort();
    if(!dates.length)throw new Error('empty task');
    if(kind==='coupon') {
      // 检查跨标记桶也没有同用户重复，防止求和掩盖源表粒度错误。
      const control=await query(kind,[day,'group_type'],conditions,counts);
      for(const c of control) {
        const actual=summarize(kind,rows.filter(r=>r.date===c[day] && r.group_type===c.group_type));
        if(actual.users!==finite(c.users) || finite(c.users)!==finite(c.records))throw new Error('overlapping coupon buckets');
      }
    }
    const dimensions={};
    for(const dimension of [...Object.keys(DIMENSIONS),...(kind==='coupon'?['activity_cycle']:[])]) {
      dimensions[dimension]=(await query(kind,[...groups,dimension],conditions,metrics)).map(r=>normalize(kind,{...r,date:r[day],value:r[dimension] ?? '未知'}));
      for(const date of dates) {
        const expected=summarize(kind,rows.filter(r=>r.date===date));
        const actual=summarize(kind,dimensions[dimension].filter(r=>r.date===date));
        for(const key of ['users','coupon','coupon_repurchase','axc','charge','unmet']) {
          if(actual[key]!==expected[key])throw new Error('dimension total mismatch');
        }
      }
    }
    tasks.push({id:kind,name:kind==='coupon'?'召回复购发券实验':'安心充低频人群分析',kind,
      metric:kind==='coupon'?'发券后 7 日复购率':'近 30 天订单渗透率',
      sourceId:sources[kind].source_id,sourceName:sources[kind].name,partition:partitions[kind],
      sourceTaskId:kind==='coupon'?'184765378':'crowd_axc_low_freq',dates,rows,dimensions,
      notes:kind==='coupon'?
        ['按单个进组日独立统计，观察入组后第 1–7 天；跨日累计归属暂未确认。','发券后复购率 = 领券且复购人数 / 领券人数；整体复购率另以入组人数为分母。','画像取当前数据源标签快照，不能视为投放前快照；城市为源表高频城市。']:
        ['每天的订单数是近 30 天滚动值，不能跨日相加；渗透率为安心充订单合计 / 充电订单合计。','个人达标人数沿用源表 achieved_flag；不等同于整体渗透率是否达标。','来源组别用于观察，真实随机分流尚未核验，不作实验因果结论。'],
    });
  }
  const audienceConditions=[filter('dt',partitions.audience),filter('crowd_id','crowd_axc_low_freq')];
  const audience={partition:partitions.audience,sourceName:sources.audience.name,sourceId:sources.audience.source_id,dimensions:{}};
  audience.rows=(await query('audience',['group_type'],audienceConditions,counts)).map(r=>normalize('audience',r));
  for(const dimension of Object.keys(DIMENSIONS)) {
    audience.dimensions[dimension]=(await query('audience',['group_type',dimension],audienceConditions,counts)).map(r=>normalize('audience',{...r,value:r[dimension]??'未知'}));
    if(summarize('audience',audience.dimensions[dimension]).users!==summarize('audience',audience.rows).users)throw new Error('audience total mismatch');
  }
  tasks.find(t=>t.id==='effect').audience=audience;
  return {version:1,builtAt:new Date().toISOString(),tasks,queries:gateway.evidence};
}

export function selectTask(snapshot,id,{date,group='all',dimension='charge_life_cycle'}={}) {
  const task=snapshot.tasks.find(t=>t.id===id);
  if(!task)return null;
  const selectedDate=date || task.dates.at(-1);
  if(!task.dates.includes(selectedDate) || !Object.keys(task.dimensions).includes(dimension))throw new Error('invalid selection');
  const groups=[...new Set(task.rows.map(r=>r.group_type))];
  if(group!=='all' && !groups.includes(group))throw new Error('invalid group');
  const scoped=rows=>rows.filter(r=>r.date===selectedDate && (group==='all'||r.group_type===group));
  const summary=summarize(task.kind,scoped(task.rows));
  const dimensionRows=scoped(task.dimensions[dimension]);
  const comparisonRows=task.dimensions[dimension].filter(r=>r.date===selectedDate);
  const comparisonValues=[...new Set(comparisonRows.map(r=>r.value))];
  const distribution=[...new Set(dimensionRows.map(r=>r.value))].map(value=>({value,...summarize(task.kind,dimensionRows.filter(r=>r.value===value))})).sort((a,b)=>b.users-a.users);
  const audienceRows=task.audience?.dimensions[dimension]?.filter(r=>group==='all'||r.group_type===group);
  const portrait=audienceRows?[...new Set(audienceRows.map(r=>r.value))].map(value=>({value,...summarize('audience',audienceRows.filter(r=>r.value===value))})).sort((a,b)=>b.users-a.users):distribution;
  const {rows,dimensions,audience,...metadata}=task;
  return {...metadata,selectedDate,selectedGroup:group,dimension,dimensionOptions:{...DIMENSIONS,...(task.kind==='coupon'?{activity_cycle:'流失周期'}:{})},groups,
    groupDistribution:groups.map(g=>({group:g,rows:comparisonValues.map(value=>({value,...summarize(task.kind,comparisonRows.filter(r=>r.value===value && r.group_type===g))}))})),
    summary,distribution,portrait,portraitPartition:audience?.partition || task.partition,
    portraitGroups:groups.map(g=>({group:g,...summarize('audience',audience?audience.rows.filter(r=>r.group_type===g):task.rows.filter(r=>r.date===selectedDate && r.group_type===g))})),
    groupSummary:groups.map(g=>({group:g,...summarize(task.kind,task.rows.filter(r=>r.date===selectedDate && r.group_type===g))})),
    groupDaily:groups.map(g=>({group:g,rows:task.dates.map(d=>({date:d,...summarize(task.kind,task.rows.filter(r=>r.date===d && r.group_type===g))}))})),
    daily:task.dates.map(d=>({date:d,...summarize(task.kind,task.rows.filter(r=>r.date===d && (group==='all'||r.group_type===group)))})),
    evidence:snapshot.queries.filter(q=>q.sourceId===task.sourceId || q.sourceId===audience?.sourceId),
  };
}

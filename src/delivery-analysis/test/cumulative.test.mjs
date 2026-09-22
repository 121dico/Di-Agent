import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCumulative, selectCumulative} from '../server/cumulative.mjs';

const sourceRows=[
  {duid:1,group_type:'A',city_name:'北京',is_coupon:1,is_full_coupon:1,is_repurchase_7d:0,is_full_coupon_repurchase_7d:0},
  {duid:1,group_type:'A',city_name:'北京',is_coupon:1,is_full_coupon:1,is_repurchase_7d:1,is_full_coupon_repurchase_7d:1},
  {duid:1,group_type:'B',city_name:'北京',is_coupon:1,is_full_coupon:1,is_repurchase_7d:1,is_full_coupon_repurchase_7d:1},
  {duid:2,group_type:'B',city_name:'上海',is_coupon:1,is_full_coupon:0,is_repurchase_7d:0,is_full_coupon_repurchase_7d:0},
  {duid:3,group_type:'B',city_name:'上海',is_coupon:0,is_full_coupon:0,is_repurchase_7d:1,is_full_coupon_repurchase_7d:0},
];
async function aggregate(kind,groups,conditions,metrics){
  assert.deepEqual(metrics,[{name:'duid',aggregation:'COUNT_DISTINCT',alias:'users'}]);
  const buckets=new Map();
  for(const r of sourceRows.filter(r=>conditions.every(f=>r[f.name]===f.value))){const key=JSON.stringify(groups.map(g=>r[g]));if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
  return [...buckets.values()].map(rows=>({...Object.fromEntries(groups.map(g=>[g,rows[0][g]])),users:new Set(rows.map(r=>r.duid)).size}));
}
test('累计由跨日去重查询产生，跨组同用户不重复计入整体，分日切换不改累计',async()=>{
 const data=await buildCumulative({query:aggregate,kind:'coupon',conditions:[],dimensions:['city_name'],dates:['2026-08-12','2026-08-24']});
 const overall=selectCumulative(data,{dimension:'city_name'});
 assert.equal(overall.summary.users,3);
 assert.equal(overall.summary.coupon,2);
 assert.equal(overall.summary.coupon_repurchase,1);
 assert.equal(overall.summary.rate,.5);
 assert.equal(overall.summary.unmet,1);
 assert.equal(overall.groupOverlap,1);
 assert.equal(overall.distribution.find(r=>r.value==='北京').unmet,0);
 assert.equal(selectCumulative(data,{group:'B',dimension:'city_name'}).summary.users,3);
 assert.throws(()=>selectCumulative(data,{group:'unknown',dimension:'city_name'}));
});

test('累计维度阶段查询缺失时拒绝发布，不能把成功人群误算为未达成',async()=>{
 const broken=async(kind,groups,conditions,metrics)=>{
   if(groups.includes('city_name') && conditions.some(f=>f.name.includes('repurchase')))return [];
   return aggregate(kind,groups,conditions,metrics);
 };
 await assert.rejects(buildCumulative({query:broken,kind:'coupon',conditions:[],dimensions:['city_name'],dates:['2026-08-12','2026-08-24']}),/incomplete cumulative partition/);
});

test('独立分日查询不重复计算跨组用户，领券复购仍须同一记录同时满足',async()=>{
 const {buildDailyUnion}=await import('../server/daily.mjs');
 const result=await buildDailyUnion({query:aggregate,kind:'coupon',conditions:[],dimensions:['city_name'],day:'entry_dt'});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].users,3);assert.equal(result.rows[0].coupon,2);assert.equal(result.rows[0].coupon_repurchase,1);assert.equal(result.rows[0].rate,.5);
 assert.equal(result.dimensions.city_name.rows.find(r=>r.value==='上海').unmet,1);
});

test('自定义周期漏斗独立去重跨日用户，不能把每日人数直接相加',async()=>{
 const {buildPeriodFunnels}=await import('../server/daily.mjs');
 const rows=[{duid:1,entry_dt:'2026-08-12',group_type:'A',is_coupon:1,is_repurchase_7d:0,is_full_coupon:0,is_full_coupon_repurchase_7d:0},{duid:1,entry_dt:'2026-08-13',group_type:'A',is_coupon:1,is_repurchase_7d:1,is_full_coupon:0,is_full_coupon_repurchase_7d:0}];
 const query=async(kind,groups,conditions)=>{
  const selected=rows.filter(r=>conditions.every(f=>f.operator==='GEQ'?r[f.name]>=f.value:f.operator==='LEQ'?r[f.name]<=f.value:r[f.name]===f.value));
  const buckets=new Map();for(const r of selected){const key=JSON.stringify(groups.map(g=>r[g]));if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
  return [...buckets.values()].map(rs=>({...Object.fromEntries(groups.map(g=>[g,rs[0][g]])),users:new Set(rs.map(r=>r.duid)).size}));
 };
 const result=await buildPeriodFunnels({query,kind:'coupon',conditions:[],dates:['2026-08-12','2026-08-13','2026-08-14'],day:'entry_dt',cumulative:{scopes:[]}});
 const total=result.periods['2026-08-12/2026-08-13'].find(r=>r.group==='all').summary;
 assert.equal(total.users,1);assert.equal(total.coupon,1);assert.equal(total.coupon_repurchase,1);assert.equal(total.rate,1);
});

test('分日漏掉既有日期不能发布；周期失败等待在途查询结束并停止领新任务',async()=>{
 const {buildDailyUnion,buildPeriodFunnels}=await import('../server/daily.mjs');
 await assert.rejects(buildDailyUnion({query:async()=>[],kind:'coupon',conditions:[],dimensions:[],day:'entry_dt',source:{rows:[]},control:{rows:[{date:'2026-08-12',users:1}]}}),/date coverage/);
 let release,calls=0,ended=false;
 const query=async()=>{calls++;if(calls===1)throw new Error('upstream');if(calls===2)await new Promise(r=>release=r);return [];};
 const pending=buildPeriodFunnels({query,kind:'effect',conditions:[],dates:['2026-08-12','2026-08-13','2026-08-14'],day:'stat_dt',cumulative:{scopes:[]}}).finally(()=>ended=true);
 const rejected=assert.rejects(pending,/upstream/);
 await new Promise(r=>setImmediate(r));assert.equal(ended,false);release();await rejected;
 assert.equal(ended,true);assert.ok(calls<=5,'失败后不领取后续日期区间');
});

test('跨组重复场景也以每组阶段总量约束整体，不能只检查flag单桶',async()=>{
 const {buildDailyUnion}=await import('../server/daily.mjs');
 const source={rows:[{date:'d',group_type:'A',users:5,coupon:5,full:0,repurchase:0,coupon_repurchase:0,full_repurchase:0},{date:'d',group_type:'A',users:5,coupon:5,full:0,repurchase:0,coupon_repurchase:0,full_repurchase:0},{date:'d',group_type:'B',users:1,coupon:0,full:0,repurchase:0,coupon_repurchase:0,full_repurchase:0}]};
 const query=async(kind,groups,conditions)=>conditions.length===1&&conditions[0].name==='is_coupon'?[{entry_dt:'d',users:5}]:conditions.length?[]:[{entry_dt:'d',users:10}];
 await assert.rejects(buildDailyUnion({query,kind:'coupon',conditions:[],dimensions:[],day:'entry_dt',source,control:{rows:[{date:'d',users:10,overlapUsers:1}]}}),/daily stage/);
});

test('累计组合与逐级下钻使用联合去重桶，分组切换保留同一筛选条件',async()=>{
 const fixture=sourceRows.map(r=>({...r,member:r.duid===1?'会员':'非会员',life:r.duid===3?'成长':'老用户'}));
 const query=async(kind,groups,conditions)=>{
  const buckets=new Map();for(const r of fixture.filter(r=>conditions.every(f=>r[f.name]===f.value))){const key=JSON.stringify(groups.map(g=>r[g]));if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}
  return [...buckets.values()].map(rs=>({...Object.fromEntries(groups.map(g=>[g,rs[0][g]])),users:new Set(rs.map(r=>r.duid)).size}));
 };
 const data=await buildCumulative({query,kind:'coupon',conditions:[],dimensions:['city_name','member','life'],dates:['2026-08-12','2026-08-24']});
 const selected=selectCumulative(data,{dimension:'life',breakdown:{dimensions:['member','city_name'],filters:[{dimension:'life',value:'老用户'}]}});
 assert.equal(selected.breakdown.summary.users,2);assert.equal(selected.breakdown.summary.success,1);assert.equal(selected.breakdown.rows.length,2);
 assert.deepEqual(selected.breakdown.rows.find(r=>r.success===1).values,['会员','北京']);
 assert.equal(selected.breakdown.rows.find(r=>r.success===0).share,.5);
 assert.equal(selectCumulative(data,{group:'A',dimension:'life',breakdown:{dimensions:['city_name'],filters:[{dimension:'member',value:'非会员'}]}}).breakdown.summary.users,0);
 const thirdLevel=selectCumulative(data,{dimension:'life',breakdown:{dimensions:['city_name'],filters:[{dimension:'member',value:'非会员'},{dimension:'life',value:'老用户'}]}}).breakdown;
 assert.equal(thirdLevel.summary.users,1);assert.deepEqual(thirdLevel.rows[0].values,['上海']);
 assert.throws(()=>selectCumulative(data,{dimension:'life',breakdown:{dimensions:['city_name','member','life','extra'],filters:[]}}));
 assert.throws(()=>selectCumulative(data,{dimension:'life',breakdown:{dimensions:['life'],filters:[{dimension:'life',value:'老用户'}]}}));
 assert.throws(()=>selectCumulative(data,{dimension:'life',breakdown:{dimensions:['missing'],filters:[]}}));
});

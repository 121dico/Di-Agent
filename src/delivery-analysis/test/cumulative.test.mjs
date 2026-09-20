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

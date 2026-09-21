import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildSnapshot, selectTask} from '../server/snapshot.mjs';
const contracts=JSON.parse(await readFile(new URL('./fixtures/delivery-contracts.json',import.meta.url),'utf8'));

// 网关为公共输入边界：模拟它返回的聚合行，不模拟快照内部函数。
function gateway() {
  return {
    evidence:[], contracts:async()=>contracts,
    async query(query) {
      this.evidence.push({queryId:'query-'+this.evidence.length,sourceId:query.source_id,query});
      for(const field of query.fields)assert.ok(!['duid','first_axc_order_id','last_axc_order_id'].includes(field.name)||field.aggregation,'不能选择原始用户/订单 ID');
      if(query.fields.length===1&&query.group_by.length===1&&query.group_by[0]==='dt')return [{dt:'2026-09-19'}];
      const values={dt:'2026-09-19',group_type:'A',entry_dt:'2026-08-24',stat_dt:'2026-09-19',users:2,records:2,axc:1,charge:10,achieved:1,unmet:1,target_min:.12,target_max:.12,target_count:2,rate_sum:.3,rate_count:2,rate_min:.1,rate_max:.2,is_entry:1,is_coupon:1,is_full_coupon:1,is_repurchase_7d:1,is_full_coupon_repurchase_7d:0};
      if(query.filters.some(f=>f.operator==='EQ'&&f.name==='is_full_coupon_repurchase_7d'&&f.value===1))return [];
      return [Object.fromEntries(query.fields.map(f=>[f.alias||f.name,values[f.alias||f.name]??'已知']))];
    },
  };
}
test('57 个合同字段都有实际查询用途，完整发券复购采用独立源标记',async()=>{
  const snapshot=await buildSnapshot(gateway());
  assert.equal(snapshot.fieldCoverage.flatMap(s=>s.fields).length,57);
  assert.deepEqual(snapshot.fieldCoverage.flatMap(s=>s.fields).filter(f=>f.status!=='已接入'),[]);
  const coupon=selectTask(snapshot,'coupon');
  assert.equal(coupon.summary.full,2);
  assert.equal(coupon.summary.repurchase,2);
  assert.equal(coupon.summary.full_repurchase,0);
  const effect=selectTask(snapshot,'effect',{portraitDimension:'charge_is_member_active'});
  assert.equal(effect.summary.personalTarget,.12);
  assert.equal(effect.audienceFacts.orderCoverage.first_axc_order_id,2);
  assert.equal(effect.audienceFacts.summary.axc,1);
});
test('无效进组标记阻止错误漏斗快照发布',async()=>{
  const fake=gateway(),query=fake.query;
  fake.query=async function(q){const rows=await query.call(this,q);return rows.map(r=>Object.hasOwn(r,'is_entry')?{...r,is_entry:0}:r);};
  await assert.rejects(buildSnapshot(fake),/invalid coupon stages/);
});

test('新增个人效果指标缺失或覆盖数越界时不发布快照',async()=>{
  for(const replacement of [{rate_count:3},{rate_sum:null},{target_min:null}]){
    const fake=gateway(),query=fake.query;
    fake.query=async function(q){const rows=await query.call(this,q);return rows.map(r=>Object.hasOwn(r,'target_count')?{...r,...replacement}:r);};
    await assert.rejects(buildSnapshot(fake),/invalid personal/);
  }
});

test('联合快照逐维对账，不允许同总数但错标签的联合桶发布',async()=>{
 const fake=gateway(),query=fake.query;
 fake.query=async function(q){const rows=await query.call(this,q);return q.group_by.includes('city_name')&&q.group_by.includes('charge_life_cycle')?rows.map(r=>({...r,city_name:'错误城市'})):rows;};
 await assert.rejects(buildSnapshot(fake),/joint marginal mismatch/);
});

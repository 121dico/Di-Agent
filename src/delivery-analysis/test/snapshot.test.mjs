import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../server/snapshot.mjs';

test('发券后复购使用领券样本，未领券复购不进入分子', () => {
  const result = summarize('coupon', [
    {group_type:'treatment_group', users:10, records:10, coupon:6, full:4, repurchase:5, coupon_repurchase:3, full_repurchase:2},
    {group_type:'control_group', users:8, records:8, coupon:4, full:4, repurchase:2, coupon_repurchase:1, full_repurchase:1},
  ]);
  assert.equal(result.users,18);
  assert.equal(result.rate,0.4);
  assert.equal(result.overallRate,7/18);
  assert.equal(result.unmet,6);
});

test('零领券样本没有复购率；安心充用订单分子分母且不借用复购标记', () => {
  assert.equal(summarize('coupon',[{users:3,records:3,repurchase:1}]).rate,null);
  const result=summarize('effect',[{users:2,records:2,axc:2,charge:10,achieved:1,unmet:1}]);
  assert.equal(result.rate,0.2);
  assert.equal(result.unmet,1);
});

test('新快照查询失败时不替换已发布快照', async () => {
  const { SnapshotStore } = await import('../server/store.mjs');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path=await mkdtemp(tmpdir()+'/delivery-test-');
  let fail=false;
  const store=new SnapshotStore(path,async()=>{if(fail) throw new Error('upstream unavailable');return {version:1,tasks:[{id:'coupon',dates:['2026-08-12']}],builtAt:'2026-09-20T00:00:00Z'};});
  try {
    await store.refresh();fail=true;await store.refresh();
    assert.equal(store.snapshot.tasks[0].id,'coupon');
    assert.ok(store.status.lastError);
    const reloaded=new SnapshotStore(path,async()=>{});await reloaded.load();
    assert.equal(reloaded.snapshot.builtAt,'2026-09-20T00:00:00Z');
  } finally {await rm(path,{recursive:true,force:true});}
});

test('个人目标与个人渗透率保留覆盖和范围，不代替整体订单比率', () => {
  const result=summarize('effect',[
    {users:2,records:2,axc:4,charge:20,target_min:.12,target_max:.12,target_count:2,rate_sum:2.2,rate_count:2,rate_min:.2,rate_max:2},
    {users:1,records:1,axc:1,charge:20,target_min:.12,target_max:.12,target_count:1,rate_sum:.1,rate_count:1,rate_min:.1,rate_max:.1},
  ]);
  assert.equal(result.rate,.125);
  assert.equal(result.personalTarget,.12);
  assert.ok(Math.abs(result.personalRateMean-2.3/3)<1e-12);
  assert.equal(result.personalRateMax,2);
  assert.equal(summarize('effect',[{users:2,target_min:.1,target_max:.2,target_count:2}]).personalTarget,null);
  assert.equal(summarize('effect',[{users:2,target_min:0,target_max:0,target_count:1}]).personalTarget,null);
  assert.equal(summarize('effect',[{users:2,target_min:0,target_max:0,target_count:2}]).personalTarget,0);
  assert.equal(summarize('effect',[]).personalRateMean,null);
});

test('额外画像维度独立于分日效果维度，ID 仅作为非空覆盖统计', async()=>{
  const {selectTask}=await import('../server/snapshot.mjs');
  const snapshot={queries:[],tasks:[{id:'effect',kind:'effect',sourceId:'effect-source',dates:['2026-09-19'],rows:[{date:'2026-09-19',group_type:'A',users:2,records:2,axc:1,charge:10}],dimensions:{charge_life_cycle:[{date:'2026-09-19',group_type:'A',value:'老用户',users:2,records:2,axc:1,charge:10}]},audience:{partition:'2026-09-19',rows:[{group_type:'A',users:2,axc:1,charge:10}],dimensions:{charge_life_cycle:[],charge_is_member_active:[{group_type:'A',value:1,users:1},{group_type:'A',value:'未知',users:1}]},orderCoverage:{first_axc_order_id:[{group_type:'A',users:1}],last_axc_order_id:[{group_type:'A',users:2}]}}}]};
  const result=selectTask(snapshot,'effect',{portraitDimension:'charge_is_member_active'});
  assert.equal(result.dimension,'charge_life_cycle');
  assert.equal(result.portraitDimension,'charge_is_member_active');
  assert.equal(result.distribution[0].value,'老用户');
  assert.equal(result.portrait[0].users,1);
  assert.equal(result.audienceFacts.orderCoverage.first_axc_order_id,1);
  assert.equal(result.audienceFacts.summary.axc,1);
  assert.throws(()=>selectTask(snapshot,'effect',{portraitDimension:'nonexistent'}));
});

test('旧快照缺少新增效果字段时不伪装为零覆盖',()=>{
  const old=summarize('effect',[{users:100,records:100,axc:20,charge:100,achieved:50,unmet:50}]);
  assert.equal(old.rate_count,null);
  assert.equal(old.target_count,null);
  assert.equal(old.personalTarget,null);
  assert.equal(old.personalRateMean,null);
});

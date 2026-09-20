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

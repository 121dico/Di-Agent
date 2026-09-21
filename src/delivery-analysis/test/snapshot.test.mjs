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

test('召回可读取人工核验分流参考，但不改变漏斗统计或冒充其他任务数据',async()=>{
  const {selectTask}=await import('../server/snapshot.mjs');
  const rows=[{date:'2026-08-24',group_type:'control_group',users:10,records:10,coupon:8,coupon_repurchase:4}];
  const task={id:'coupon',kind:'coupon',sourceTaskId:'184765378',sourceId:'coupon',dates:['2026-08-24'],rows,dimensions:{charge_life_cycle:rows.map(r=>({...r,value:'老用户'}))}};
  const snapshot={queries:[],tasks:[task]};
  const actual=selectTask(snapshot,'coupon');
  assert.equal(actual.experimentReference.experimentId,'501026732376065');
  assert.equal(actual.experimentReference.observedOn,'2026-09-21');
  assert.equal(actual.experimentReference.records.at(-1).control_group,117098);
  assert.equal(actual.experimentReference.records.at(-1).treatment_group,117218);
  assert.equal(actual.summary.users,10);assert.equal(actual.summary.rate,.5);
  task.sourceTaskId='unrelated';assert.equal(selectTask(snapshot,'coupon').experimentReference,null);
});


test('均衡模块可读取当前四维分组画像，缺维度不补零且不冒充投放前结论',async()=>{
  const {selectTask}=await import('../server/snapshot.mjs');
  const rows=[{date:'2026-08-24',group_type:'treatment_group',users:10},{date:'2026-08-24',group_type:'control_group',users:20}];
  const values=[{...rows[0],value:'老用户',users:8},{...rows[0],value:'未知',users:2},{...rows[1],value:'老用户',users:10},{...rows[1],value:'新用户',users:10}];
  const snapshot={queries:[],tasks:[{id:'coupon',kind:'coupon',sourceTaskId:'184765378',sourceName:'coupon-source',partition:'2026-09-16',dates:['2026-08-24'],rows,dimensions:{charge_life_cycle:values,charge_freq_type:values,charge_duid_role_name_v2_type:values}}]};
  const actual=selectTask(snapshot,'coupon',{group:'control_group'}).groupPortrait;
  assert.ok(actual,'当前来源已有两组画像，均衡模块应返回可展示的分组数据');
  assert.equal(actual.basis,'current_snapshot');assert.equal(actual.partition,'2026-09-16');assert.equal(actual.cohortDate,'2026-08-24');
  assert.deepEqual(actual.groups,[{group:'treatment_group',users:10},{group:'control_group',users:20}]);
  const life=actual.dimensions.find(d=>d.key==='charge_life_cycle');
  assert.equal(life.status,'available');
  assert.deepEqual(life.values.find(v=>v.value==='老用户').groups,[{group:'treatment_group',users:8,share:.8},{group:'control_group',users:10,share:.5}]);
  assert.equal(life.values.find(v=>v.value==='新用户').groups[0].users,0);
  assert.equal(actual.dimensions.find(d=>d.key==='member_status').status,'missing');
  assert.equal(actual.conclusion,null);
});


test('当前分组画像按人群快照独立于效果选日，零组和缺桶不产生假比例',async()=>{
 const {selectTask}=await import('../server/snapshot.mjs');
 const rows=[{date:'2026-09-19',group_type:'control',users:1}];
 const snapshot={queries:[],tasks:[{id:'effect',kind:'effect',dates:['2026-09-19'],rows,dimensions:{charge_life_cycle:rows},audience:{partition:'2026-09-20',rows:[{group_type:'control',users:0},{group_type:'experiment',users:10}],dimensions:{charge_life_cycle:[{group_type:'experiment',value:'老用户',users:10}],charge_freq_type:[{group_type:'experiment',value:'低频',users:9}]}}}]};
 const result=selectTask(snapshot,'effect').groupPortrait;
 assert.equal(result.partition,'2026-09-20');assert.equal(result.cohortDate,null);
 assert.equal(result.dimensions[0].values[0].groups[0].share,null);
 assert.equal(result.dimensions[0].maxShareGap,null);
 assert.equal(result.dimensions[1].status,'inconsistent');assert.deepEqual(result.dimensions[1].values,[]);
});

test('PRD三个Ditag包保留当前值与投放前规则版本，不改变漏斗或串到安心充',async()=>{
 const {selectTask}=await import('../server/snapshot.mjs');
 const rows=[{date:'2026-08-24',group_type:'control_group',users:10}];
 const task={id:'coupon',kind:'coupon',sourceTaskId:'184765378',dates:['2026-08-24'],rows,dimensions:{charge_life_cycle:rows.map(r=>({...r,value:'老用户'}))}};
 const snapshot={queries:[],tasks:[task]};const result=selectTask(snapshot,'coupon');
 assert.equal(result.crowdReferences.length,3);
 const pack=result.crowdReferences.find(c=>c.id==='1011337415');
 assert.equal(pack.currentUsers,1781910);assert.equal(pack.name,'私家车流失31-60天');assert.equal(pack.prdLabel,'私家车流失60～90天');
 assert.equal(pack.historical.version,'V4');assert.equal(pack.historical.name,'私家车流失60-90天');
 assert.equal(result.summary.users,10);assert.equal(pack.historical.users,null);
 task.kind='effect';assert.deepEqual(selectTask(snapshot,'coupon').crowdReferences,[]);
});

test('六条BOSS配置按包和组关联，时间与红包ID保真且不污染统计',async()=>{
 const {selectTask}=await import('../server/snapshot.mjs');
 const rows=[{date:'2026-08-24',group_type:'control_group',users:10}];
 const task={id:'coupon',kind:'coupon',sourceTaskId:'184765378',dates:['2026-08-24'],rows,dimensions:{charge_life_cycle:rows.map(r=>({...r,value:'老用户'}))}};
 const snapshot={queries:[],tasks:[task]},result=selectTask(snapshot,'coupon');
 const ref=result.deploymentReference;assert.ok(ref);assert.equal(ref.records.length,6);
 assert.deepEqual(ref.records.filter(r=>r.crowdId==='1011337415').map(r=>[r.group,r.redPacketId]),[['control_group','1533894165925072896'],['treatment_group','1531349257259610112']]);
 assert.equal(ref.records[0].createdAt,'2026-08-12 17:34:05');assert.equal(ref.records[0].offlineAt,'2026-08-24 15:56:02');
 assert.equal(ref.schedule.end,'2026-12-31 23:59:59');assert.equal(ref.records[0].resourceId,null);
 assert.equal(ref.cities.length,100);assert.equal(ref.channels.length,7);assert.equal(ref.businessTarget,null);
 assert.equal(result.summary.users,10);task.kind='effect';assert.equal(selectTask(snapshot,'coupon').deploymentReference,null);
});

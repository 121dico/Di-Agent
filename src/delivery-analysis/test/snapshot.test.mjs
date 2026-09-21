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

test('三级画像来自联合计数，保留真实相关性并受日期与组别约束',async()=>{
 const {selectTask}=await import('../server/snapshot.mjs');
 const rows=[{date:'2026-08-24',group_type:'control_group',users:10,records:10}];
 const task={id:'coupon',kind:'coupon',dates:['2026-08-24'],rows,dimensions:{charge_life_cycle:[{...rows[0],value:'老用户'}],charge_freq_type:[],city_name:[]},profileCube:{keys:['charge_life_cycle','charge_freq_type','city_name'],rows:[
 {...rows[0],charge_life_cycle:'老用户',charge_freq_type:'低频',city_name:'北京',users:8,records:8},
 {...rows[0],charge_life_cycle:'老用户',charge_freq_type:'高频',city_name:'上海',users:2,records:2},
 ]}};
 const snapshot={queries:[],tasks:[task]};
 const result=selectTask(snapshot,'coupon',{profileDimensions:['charge_life_cycle','charge_freq_type','city_name']});
 assert.equal(result.profileAnalysis.total,10);
 assert.deepEqual(result.profileAnalysis.rows.map(r=>[r.values,r.users,r.share,r.parentShare]),[[['老用户','低频','北京'],8,.8,1],[['老用户','高频','上海'],2,.2,1]]);
 assert.equal(result.profileAnalysis.basis,'joint_snapshot');
 assert.equal(result.profileCube,undefined,'完整多维聚合不得通过bootstrap暴露');
 assert.throws(()=>selectTask(snapshot,'coupon',{profileDimensions:['city_name','city_name']}));
 assert.throws(()=>selectTask(snapshot,'coupon',{profileDimensions:['city_name','charge_freq_type','charge_life_cycle','member_status']}));
 delete task.profileCube;
 assert.equal(selectTask(snapshot,'coupon',{profileDimensions:['charge_life_cycle','city_name']}).profileAnalysis.status,'missing');
});

test('画像来源契约给出真实表与过滤条件，安心充不混入效果选日',async()=>{
 const {selectTask}=await import('../server/snapshot.mjs');
 const rows=[{date:'2026-08-24',group_type:'control',users:10,records:10}];
 const dims={charge_life_cycle:rows.map(r=>({...r,value:'老用户'}))};
 const coupon={id:'coupon',kind:'coupon',sourceName:'coupon_table',sourceId:'c',sourceTaskId:'184765378',partition:'2026-09-16',dates:['2026-08-24'],rows,dimensions:dims};
 const source=selectTask({queries:[],tasks:[coupon]},'coupon',{group:'control'}).portraitSource;
 assert.equal(source.scope,'entry_day');assert.equal(source.sourceName,'coupon_table');
 assert.deepEqual(source.filters,[{name:'dt',value:'2026-09-16'},{name:'source_task_id',value:'184765378'},{name:'entry_dt',value:'2026-08-24'},{name:'group_type',value:'control'}]);
 const effect={...coupon,id:'effect',kind:'effect',sourceTaskId:'crowd_axc_low_freq',audience:{sourceName:'audience_table',sourceId:'a',partition:'2026-09-20',rows,dimensions:dims}};
 const other=selectTask({queries:[],tasks:[effect]},'effect').portraitSource;
 assert.equal(other.scope,'crowd_snapshot');assert.equal(other.sourceName,'audience_table');
 assert.deepEqual(other.filters,[{name:'dt',value:'2026-09-20'},{name:'crowd_id',value:'crowd_axc_low_freq'}]);
});

test('全部组画像使用跨组独立去重桶，不能相加含重叠DUID的分组人数',async()=>{
 const {selectTask}=await import('../server/snapshot.mjs');
 const rows=[{date:'2026-08-24',group_type:'control',users:5,records:5},{date:'2026-08-24',group_type:'treatment',users:4,records:4}];
 const dims={charge_life_cycle:rows.map(r=>({...r,value:'老用户'}))};
 const all={rows:[{date:'2026-08-24',users:8,records:9,overlapUsers:1}],dimensions:{charge_life_cycle:[{date:'2026-08-24',value:'老用户',users:8}]},profileCube:{keys:['charge_life_cycle'],rows:[]}};
 const task={id:'coupon',kind:'coupon',sourceTaskId:'184765378',dates:['2026-08-24'],rows,dimensions:dims,allGroupPortrait:all};
 const result=selectTask({queries:[],tasks:[task]},'coupon');
 assert.equal(result.portrait[0].users,8);assert.equal(result.profileAnalysis.total,8);
 assert.equal(result.portraitSource.overlapUsers,1);assert.equal(result.allGroupPortrait,undefined);
 assert.equal(selectTask({queries:[],tasks:[task]},'coupon',{group:'control'}).portrait[0].users,5);
 delete task.allGroupPortrait;
 const missing=selectTask({queries:[],tasks:[task]},'coupon');assert.deepEqual(missing.portrait,[]);assert.equal(missing.profileAnalysis.status,'missing');
});

test('构建跨组画像查独立去重数据，拒绝同DUID跨标签导致的重复合计',async()=>{
 const {buildAllGroupPortrait}=await import('../server/profile.mjs');
 const source={rows:[{date:'d',group_type:'A',users:5},{date:'d',group_type:'B',users:4}],dimensions:{charge_life_cycle:[{date:'d',group_type:'A',value:'老用户',users:5},{date:'d',group_type:'B',value:'老用户',users:4}]},profileCube:{keys:['charge_life_cycle'],rows:[]}};
 let seen=0;
 const query=async(kind,groups,filters)=>{assert.ok(!filters.some(f=>f.name==='group_type'));seen++;return groups[0]==='entry_dt'?[{entry_dt:'d',users:8,records:9}]:[{charge_life_cycle:'老用户',users:8,records:9}];};
 const result=await buildAllGroupPortrait({query,kind:'coupon',conditions:[],source,keys:['charge_life_cycle'],day:'entry_dt'});
 assert.equal(result.rows[0].users,8);assert.equal(result.rows[0].overlapUsers,1);assert.equal(result.profileCube.rows[0].users,8);assert.equal(seen,3);
 await assert.rejects(buildAllGroupPortrait({query:async(kind,groups,filters)=>groups[0]==='entry_dt'?[{entry_dt:'d',users:8,records:9}]:[{charge_life_cycle:'老用户',users:9,records:9}],kind:'coupon',conditions:[],source,keys:['charge_life_cycle'],day:'entry_dt'}),/all-group labels overlap/);
});


test('全部组控制查询缺失或重复日期时拒绝发布，不把缺失当零人',async()=>{
 const {buildAllGroupPortrait}=await import('../server/profile.mjs');
 const source={rows:[{date:'d1',users:1},{date:'d2',users:1}],dimensions:{},profileCube:{keys:[],rows:[]}};
 for(const controls of [[{entry_dt:'d1',users:1,records:1}],[{entry_dt:'d1',users:1,records:1},{entry_dt:'d1',users:1,records:1}]]){
  await assert.rejects(buildAllGroupPortrait({query:async()=>controls,kind:'coupon',conditions:[],source,keys:[],day:'entry_dt'}),/date coverage mismatch/);
 }
 await assert.rejects(buildAllGroupPortrait({query:async()=>[{dt:'wrong',users:1,records:1}],kind:'audience',conditions:[{name:'dt',operator:'EQ',value:'expected'}],source,keys:[]}),/date coverage mismatch/);
});

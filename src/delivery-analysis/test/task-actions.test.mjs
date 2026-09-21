import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createServer} from '../server/index.mjs';
import {AnalysisTasks} from '../server/analysis-tasks.mjs';
const snapshot={builtAt:'2026-09-21T00:00:00Z',queries:[],tasks:[{id:'coupon',name:'召回任务',kind:'coupon',dates:['2026-08-12'],rows:[{date:'2026-08-12',group_type:'treatment_group',users:10,records:10,coupon:6,coupon_repurchase:3}],dimensions:{charge_life_cycle:[{date:'2026-08-12',group_type:'treatment_group',value:'老用户',users:10,records:10,coupon:6,coupon_repurchase:3}]}}]};
async function serve(directory,run){
 const tasks=new AnalysisTasks(directory);await tasks.load();
 const server=createServer({gateway:{authenticate:async token=>{if(!token?.startsWith('Bearer '))throw Object.assign(new Error(),{code:401});return {id:token.slice(7)};}},store:{snapshot,status:{}},tasks});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,body,user='alice',method=body?'POST':'GET')=>fetch(base+path,{method,headers:{Authorization:'Bearer '+user,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 try{await run(call);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('用户创建真实分析任务，重启后保留且其他用户不可读改',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'analysis-tasks-'));let id;
 try{
  await serve(dir,async call=>{
   const r=await call('/api/tasks',{name:'九月召回复盘',purpose:'召回',sourceId:'coupon'});assert.equal(r.status,201);id=(await r.json()).item.id;
   assert.equal((await (await call('/api/bootstrap?taskId='+id)).json()).analysisTask.name,'九月召回复盘');
   assert.equal((await call('/api/bootstrap?taskId='+id,undefined,'bob')).status,404);
   assert.equal((await call('/api/tasks/'+id,{modules:['audienceProfile']},'bob','PATCH')).status,404);
   assert.equal((await call('/api/tasks/'+id,{modules:['audienceProfile']},'alice','PATCH')).status,200);
  });
  await serve(dir,async call=>{const body=await(await call('/api/tasks')).json();assert.deepEqual(body.items.find(t=>t.id===id).modules,['audienceProfile']);});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('任务输入和空模块被拒绝，并发保存不会丢失其他任务',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'analysis-tasks-'));
 try{await serve(dir,async call=>{
  for(const body of [{name:'',purpose:'召回',sourceId:'coupon'},{name:'有效',purpose:'错误',sourceId:'coupon'},{name:'有效',purpose:'召回',sourceId:'missing'}])assert.equal((await call('/api/tasks',body)).status,400);
  const responses=await Promise.all(['任务甲','任务乙'].map(name=>call('/api/tasks',{name,purpose:'召回',sourceId:'coupon'})));
  assert.ok(responses.every(r=>r.status===201));
  assert.equal((await (await call('/api/tasks')).json()).items.length,3);
  assert.equal((await call('/api/tasks/coupon',{modules:[]},'alice','PATCH')).status,400);
  assert.equal((await call('/api/export',{builtAt:snapshot.builtAt,selection:{taskId:'coupon',date:'1900-01-01'}})).status,400);
  assert.equal((await call('/api/export',{builtAt:'old',selection:{taskId:'coupon'}})).status,409);
 });}finally{await rm(dir,{recursive:true,force:true});}
});

test('刷新合并并发请求，失败后原快照仍可读取',async()=>{
 const {SnapshotStore}=await import('../server/store.mjs');
 const dir=await mkdtemp(join(tmpdir(),'analysis-refresh-'));let finish,builds=0;
 const store=new SnapshotStore(dir,async()=>{builds++;await new Promise(r=>finish=r);throw new Error('upstream');});store.snapshot=snapshot;
 const server=createServer({gateway:{authenticate:async()=>({id:'user'})},store});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 try{
  await Promise.all([fetch(base+'/api/refresh',{method:'POST'}),fetch(base+'/api/refresh',{method:'POST'})]);
  assert.equal(builds,1);assert.equal((await(await fetch(base+'/api/refresh')).json()).status.refreshing,true);
  const pending=store.pending;finish();await pending;
  assert.match((await(await fetch(base+'/api/refresh')).json()).status.lastError,/保留/);
  assert.equal((await(await fetch(base+'/api/bootstrap?taskId=coupon')).json()).task.summary.users,10);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

test('人群分析配置隔离保存，分组至少两个，删除只移除分析',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'audience-analysis-'));let id;
 const input={name:'私家车召回分析',crowdId:'1011337400',effect:{metric:'coupon_repurchase_rate',observedMetrics:['users','coupon'],targetRate:0.2,startDate:'2026-08-12'},experiment:{enabled:true,groups:[{name:'对照组',crowdId:'20001'},{name:'实验组',crowdId:'20002'}]}};
 try{
  await serve(dir,async call=>{
   assert.equal((await call('/api/tasks/coupon/audiences',{...input,experiment:{enabled:true,groups:input.experiment.groups.slice(0,1)}})).status,400);
   const response=await call('/api/tasks/coupon/audiences',input);assert.equal(response.status,201);id=(await response.json()).item.id;
   const selected=await(await call('/api/bootstrap?taskId='+id)).json();
   assert.equal(selected.analysisTask.effect.targetRate,0.2);assert.equal(selected.task.selectedCrowd.id,'1011337400');assert.ok(selected.task.scopeUnavailable);assert.deepEqual(selected.task.summary,{});
   assert.equal((await call('/api/tasks/'+id,undefined,'bob','DELETE')).status,404);
   assert.equal((await call('/api/tasks/'+id,{...input,name:'修改后的分析'},'alice','PATCH')).status,200);
  });
  await serve(dir,async call=>{
   assert.equal((await(await call('/api/bootstrap?taskId='+id)).json()).analysisTask.name,'修改后的分析');
   assert.equal((await call('/api/tasks/'+id,undefined,'alice','DELETE')).status,200);
   assert.equal((await call('/api/bootstrap?taskId='+id)).status,404);
   assert.equal((await(await call('/api/bootstrap?taskId=coupon')).json()).task.summary.users,10);
  });
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('根任务配置整体实验包后不能继续显示来源全量',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'analysis-root-scope-'));
 try{await serve(dir,async call=>{
  const response=await call('/api/tasks/coupon',{name:'召回任务',crowdId:'1011337400',effect:{metric:'coupon_repurchase_rate',observedMetrics:['users'],targetRate:.2,startDate:'2026-08-12'},experiment:{enabled:true,groups:[{name:'对照',crowdId:'20001'},{name:'实验',crowdId:'20002'}]}},'alice','PATCH');assert.equal(response.status,200);
  const selected=await(await call('/api/bootstrap?taskId=coupon')).json();assert.equal(selected.task.selectedCrowd.id,'1011337400');assert.deepEqual(selected.task.summary,{});assert.ok(selected.task.scopeUnavailable);
 });}finally{await rm(dir,{recursive:true,force:true});}
});

test('根任务整体人群范围不随实验开关丢失，非数字ID拒绝保存',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'analysis-root-crowd-'));
 const input={name:'召回任务',crowdId:'1011337400',effect:{metric:'coupon_repurchase_rate',observedMetrics:['users'],targetRate:null,startDate:'2026-08-12'},experiment:{enabled:false,groups:[]}};
 try{await serve(dir,async call=>{
  assert.equal((await call('/api/tasks/coupon',input,'alice','PATCH')).status,200);
  assert.equal((await(await call('/api/bootstrap?taskId=coupon')).json()).task.selectedCrowd.id,'1011337400');
  assert.equal((await call('/api/tasks/coupon',{...input,crowdId:'invalid'},'alice','PATCH')).status,400);
 });}finally{await rm(dir,{recursive:true,force:true});}
});

test('内置任务分日子模块配置保存版本，单选子模块自动包含分日容器',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'daily-modules-'));
 try{await serve(dir,async call=>{
  assert.equal((await call('/api/tasks/coupon',{modules:['movementTrend']},'alice','PATCH')).status,200);
  const selected=await(await call('/api/bootstrap?taskId=coupon')).json();
  assert.equal(selected.analysisTask.moduleVersion,2);assert.deepEqual(selected.analysisTask.modules,['movementTrend','subview-movement']);
 });}finally{await rm(dir,{recursive:true,force:true});}
});

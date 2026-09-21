import test from 'node:test';import assert from 'node:assert/strict';import {selectTask} from '../server/snapshot.mjs';
test('指定Ditag包只返回该包范围状态；成员关系未核验时不透传任务全量',()=>{
 const snapshot={tasks:[{id:'coupon',kind:'coupon',sourceTaskId:'184765378',rows:[{users:99999}],cumulative:{summary:{users:88888}}}]};
 for(const crowdId of ['1011337400','1011337415','1011337424']){
  const task=selectTask(snapshot,'coupon',{crowdId});assert.equal(task.selectedCrowd.id,crowdId);assert.equal(task.cumulative,null);assert.deepEqual(task.summary,{});assert.deepEqual(task.daily,[]);assert.ok(task.scopeUnavailable);
  assert.deepEqual(task.selectedCrowd.historical.rules,[]);
 }
 assert.throws(()=>selectTask(snapshot,'coupon',{crowdId:'unrecognized'}),/invalid crowd selection/);
});

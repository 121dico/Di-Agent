import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.mjs';
import { once } from 'node:events';

const rows=[{date:'2026-08-12',group_type:'treatment_group',users:10,records:10,coupon:6,coupon_repurchase:3,repurchase:4}];
const snapshot={builtAt:'2026-09-20T00:00:00Z',queries:[],tasks:[{id:'coupon',kind:'coupon',dates:['2026-08-12'],rows,dimensions:{charge_life_cycle:rows.map(r=>({...r,value:'老用户'}))}}]};
async function withServer(run,ready=true,selectedSnapshot=snapshot) {
  const server=createServer({gateway:{authenticate:async(token)=>{if(token!=='Bearer valid'){const e=new Error();e.code=401;throw e;}return {id:'user'};}},store:{snapshot:ready?selectedSnapshot:null,status:{refreshing:!ready}}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {await run('http://127.0.0.1:'+server.address().port);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('未登录无法读取真实聚合，未知任务不得回落到其他任务',()=>withServer(async(base)=>{
  assert.equal((await fetch(base+'/api/bootstrap')).status,401);
  assert.equal((await fetch(base+'/api/bootstrap?taskId=unknown',{headers:{Authorization:'Bearer valid'}})).status,404);
  const response=await fetch(base+'/api/bootstrap?taskId=coupon',{headers:{Authorization:'Bearer valid'}});
  const body=await response.json();assert.equal(body.env,'live');assert.equal(body.task.summary.rate,0.5);
  assert.equal((await fetch(base+'/data/mock_data.json')).status,404);
}));
test('没有成功快照时返回不可用，不伪造零数据',()=>withServer(async(base)=>{
  assert.equal((await fetch(base+'/api/bootstrap',{headers:{Authorization:'Bearer valid'}})).status,503);
},false));
test('不允许无效日期或分组混入其他样本',()=>withServer(async(base)=>{
  for(const suffix of ['date=2026-09-01','group=unknown','dimension=unknown']) {
    assert.equal((await fetch(base+'/api/bootstrap?'+suffix,{headers:{Authorization:'Bearer valid'}})).status,400);
  }
}));
test('分日成对视图的组别数值来自同日同维度真实聚合',()=>withServer(async(base)=>{
 const {task}=await (await fetch(base+'/api/bootstrap?taskId=coupon',{headers:{Authorization:'Bearer valid'}})).json();
 assert.equal(task.groupDistribution[0].group,'treatment_group');
 assert.equal(task.groupDistribution[0].rows[0].value,'老用户');
 assert.equal(task.groupDistribution[0].rows[0].rate,.5);
}));

test('单组筛选保留原成对视图另一来源组的真实读数',()=>{
 const both=structuredClone(snapshot),task=both.tasks[0];
 task.rows.push({...rows[0],group_type:'control_group',coupon_repurchase:1});
 task.dimensions.charge_life_cycle.push({...task.rows[1],value:'老用户'});
 return withServer(async(base)=>{
  const {task}=await (await fetch(base+'/api/bootstrap?taskId=coupon&group=treatment_group',{headers:{Authorization:'Bearer valid'}})).json();
  const control=task.groupDistribution.find(g=>g.group==='control_group').rows[0];
  assert.equal(control.users,10);assert.equal(control.rate,1/6);
 },true,both);
});

test('公开画像查询接收交叉路径，拒绝重复与超过三级的路径',()=>withServer(async(base)=>{
 const headers={Authorization:'Bearer valid'};
 for(const path of ['charge_life_cycle,charge_life_cycle','charge_life_cycle,city_name,charge_freq_type,member_status'])assert.equal((await fetch(base+'/api/bootstrap?profileDimensions='+path,{headers})).status,400);
 const result=await (await fetch(base+'/api/bootstrap?profileDimensions=charge_life_cycle',{headers})).json();
 assert.deepEqual(result.task.profileAnalysis.dimensions,['charge_life_cycle']);assert.equal(result.task.profileAnalysis.total,10);
}));

test('画像查询支持压缩传输并尊重客户端禁用压缩',()=>withServer(async(base)=>{
 const compressed=await fetch(base+'/api/bootstrap',{headers:{Authorization:'Bearer valid','Accept-Encoding':'gzip'}});
 assert.equal(compressed.headers.get('content-encoding'),'gzip');assert.equal((await compressed.json()).task.summary.users,10);
 const plain=await fetch(base+'/api/bootstrap',{headers:{Authorization:'Bearer valid','Accept-Encoding':'gzip;q=0'}});assert.equal(plain.headers.get('content-encoding'),null);
}));

test('首屏只返回50条查询预览，保留总数及完整持久快照',async()=>{
 const full=structuredClone(snapshot);full.tasks[0].sourceId='source';
 full.queries=Array.from({length:5000},(_,i)=>({sourceId:'source',queryId:'q-'+i,query:{fields:['users'],filters:[]}}));
 await withServer(async(base)=>{
  const response=await fetch(base+'/api/bootstrap',{headers:{Authorization:'Bearer valid'}});
  const text=await response.text(),body=JSON.parse(text);
  assert.equal(body.task.evidence.length,50);
  assert.equal(body.task.evidenceTotal,5000);
  assert.ok(text.length<100000,'首屏不得携带全量构建留痕');
  assert.equal(full.queries.length,5000);
 },true,full);
});

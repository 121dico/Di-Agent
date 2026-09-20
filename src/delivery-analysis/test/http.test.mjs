import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/index.mjs';
import { once } from 'node:events';

const rows=[{date:'2026-08-12',group_type:'treatment_group',users:10,records:10,coupon:6,coupon_repurchase:3,repurchase:4}];
const snapshot={builtAt:'2026-09-20T00:00:00Z',queries:[],tasks:[{id:'coupon',kind:'coupon',dates:['2026-08-12'],rows,dimensions:{charge_life_cycle:rows.map(r=>({...r,value:'老用户'}))}}]};
async function withServer(run,ready=true) {
  const server=createServer({gateway:{authenticate:async(token)=>{if(token!=='Bearer valid'){const e=new Error();e.code=401;throw e;}return {id:'user'};}},store:{snapshot:ready?snapshot:null,status:{refreshing:!ready}}});
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

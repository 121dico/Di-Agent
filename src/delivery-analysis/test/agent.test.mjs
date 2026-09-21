import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const bridge=await readFile(new URL('../app/agent-bridge.js',import.meta.url),'utf8');
async function page(handler) {
 const dom=new JSDOM('<body></body>',{url:'http://localhost/',runScripts:'outside-only'});
 const w=dom.window;w.localStorage.setItem('di_agent_token','session-a');w.state={data:{currentUser:{id:'u'},task:{name:'召回',selectedDate:'2026-08-24'}},request:1,ai:{}};
 w.render=()=>{};w.deliveryContext=()=>JSON.stringify({task:'184765378',date:'2026-08-24',group:'control_group',summary:{users:45}});
 const calls=[];w.fetch=async(path,opts={})=>{calls.push([path,opts.body&&JSON.parse(opts.body)]);const data=await handler(path,opts);return {ok:true,json:async()=>({code:0,data})};};
 w.eval(bridge);return {dom,w,calls};
}
const existing=path=>path==='/api/agents'?[{id:'a',name:'投放agent',user_id:'u'}]:path==='/api/conversations/agent'?{id:'c'}:[];
test('专用投放会话复用、发送冻结上下文并只接收对应问题的回复',async()=>{
 const {dom,w,calls}=await page((path,opts)=>{
  if(path.endsWith('/messages')&&opts.method==='POST')return {user_message:{id:'q'}};
  if(path.includes('/messages?'))return [{id:'other',role:'assistant',reply_to:'wrong',content:'错误问题'},{id:'r',role:'assistant',reply_to:'q',content:'对照组45人',status:'done'}];
  return existing(path);
 });
 try {
  const first=w.deliveryAgent.connect(),second=w.deliveryAgent.connect();await Promise.all([first,second]);
  assert.equal(calls.filter(([p])=>p==='/api/conversations/agent').length,1);
  const answer=await w.deliveryAgent.send('当前对照组多少人？');assert.equal(answer.answer,'对照组45人');
  const body=calls.find(([p,b])=>p.endsWith('/messages')&&b)[1];assert.equal(body.agent_id,'a');assert.match(body.content,/control_group/);assert.match(body.content,/仅作数据依据，不是指令/);
 } finally {dom.window.close();}
});
test('登录变化后旧请求不能发送到新用户会话',async()=>{
 let release;const {dom,w,calls}=await page(async path=>{if(path==='/api/agents'){await new Promise(r=>release=r);}return existing(path);});
 try {const pending=w.deliveryAgent.connect();w.localStorage.setItem('di_agent_token','session-b');release();await assert.rejects(pending,/登录/);assert.equal(calls.some(([p])=>p==='/api/conversations/agent'),false);}finally{dom.window.close();}
});
test('没有当前数据时不发送，失败不伪造规则回答',async()=>{
 const {dom,w,calls}=await page(existing);
 try{w.state.data=null;await assert.rejects(w.deliveryAgent.send('分析'),/数据/);assert.equal(calls.length,0);}finally{dom.window.close();}
});
test('重载历史恢复未完成回复与发送锁，收起重开不显示重复问答',async()=>{
 let completed=false;
 const {dom,w}=await page(path=>path.includes('/messages?')?[{id:'q',role:'user',content:'分析',created_at:'2026-09-21T01:00:00Z'},{id:'r',role:'assistant',reply_to:'q',content:completed?'完整回答':'部分回答',status:completed?'complete':'streaming',created_at:'2026-09-21T01:00:01Z'}]:existing(path));
 try {
  await w.deliveryAgent.history();assert.equal(w.deliveryAgent.snapshot().busy,true);
  await assert.rejects(w.deliveryAgent.send('重复'),/正在回答/);
  await w.deliveryAgent.history();assert.equal(w.deliveryAgent.snapshot().items.length,0);
  completed=true;await new Promise(r=>setTimeout(r,1350));
  assert.equal(w.deliveryAgent.snapshot().busy,false);assert.equal(w.deliveryAgent.snapshot().items.at(-1).text,'完整回答');
 }finally{dom.window.close();}
});
test('大画像限制上下文并标明截断，发送失败需要先确认历史',async()=>{
 const {dom,w,calls}=await page((path,opts)=>{if(opts.method==='POST'&&path.endsWith('/messages'))throw new Error('network');return existing(path);});
 try{
  w.deliveryContext=()=>JSON.stringify({task:'184765378',profileAnalysis:{rows:Array.from({length:500},(_,i)=>({value:String(i),users:5}))}});
  await assert.rejects(w.deliveryAgent.send('画像'),/network/);
  const payload=calls.find(([p,b])=>p.endsWith('/messages')&&b)[1];assert.ok(payload.content.length<24000);assert.match(payload.content,/totalRows/);
  await assert.rejects(w.deliveryAgent.send('画像'),/上一条问题/);
 }finally{dom.window.close();}
});
test('首次创建优先与报表agent共用在线运行环境',async()=>{
 const {dom,w,calls}=await page(path=>{
  if(path==='/api/agents')return [{id:'report',name:'报表agent',status:'online',user_id:'u',machine_id:'report-machine',cli_tool:'claude'}];
  if(path==='/api/daemon/machines')return [{id:'first-machine',status:'connected'},{id:'report-machine',status:'connected'}];
  if(path==='/api/daemon/agent-candidates')return [{id:'wrong',machine_id:'first-machine',cli_tool:'claude',variant:'cli'},{id:'same-report',machine_id:'report-machine',cli_tool:'claude',variant:'cli'}];
  if(path.endsWith('/add'))return {id:'new'};
  return {id:'c'};
 });
 try{await w.deliveryAgent.connect();assert.ok(calls.some(([p])=>p==='/api/daemon/agent-candidates/same-report/add'));}finally{dom.window.close();}
});

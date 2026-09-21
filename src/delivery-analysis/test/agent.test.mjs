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
  const body=calls.find(([p,b])=>p.endsWith('/messages')&&b)[1];assert.equal(body.agent_id,'a');assert.equal(body.content,'当前对照组多少人？');const context=calls.find(([p,b])=>p.endsWith('/blackboard')&&b)[1].manual_context;assert.match(context,/control_group/);assert.match(context,/不是指令/);
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
  const payload=calls.find(([p,b])=>p.endsWith('/messages')&&b)[1];assert.ok(payload.content.length<24000);assert.match(calls.find(([p,b])=>p.endsWith('/blackboard')&&b)[1].manual_context,/totalRows/);
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
test('投放页合并旧群聊和归档环境历史，首次连接登记页面归属且不恢复旧问题发送锁',async()=>{
 const {dom,w,calls}=await page(path=>{
  if(path==='/api/conversations?limit=100&offset=0')return [{id:'old',type:'group',title:'投放分析'},{id:'normal',type:'group',title:'业务群'}];
  if(path==='/api/conversations/archived?limit=100&offset=0')return [{id:'failed',type:'agent',title:'投放agent（旧环境鉴权失败）'}];
  if(path.includes('/old/messages?'))return [{id:'old-q',role:'user',content:'早期问题',created_at:'2026-09-20T00:00:00Z'}];
  if(path.includes('/failed/messages?'))return [{id:'old-failed',role:'assistant',content:'旧环境错误',created_at:'2026-09-20T01:00:00Z'}];
  if(path.includes('/c/messages?'))return [{id:'r',role:'assistant',content:'最新回答',status:'complete',created_at:'2026-09-21T00:00:00Z'}];
  return existing(path);
 });
 try{
  const registered=[];w.addEventListener('page-agent-conversation',event=>registered.push(event.detail));
  await w.deliveryAgent.history();
  assert.deepEqual(registered,['c','old','failed']);
  const snapshot=w.deliveryAgent.snapshot();assert.equal(snapshot.busy,false);
  assert.deepEqual(Array.from(snapshot.items,item=>item.text),['早期问题','旧环境错误','最新回答']);
  assert.equal(snapshot.items[0].historySource,'投放分析');
  assert.equal(calls.some(([url])=>url.includes('/normal/messages')),false);
 }finally{dom.window.close();}
});
test('中文页面数据不挤占消息10KB额度，提交被拒绝后可修改重发',async()=>{
 let rejectOnce=true;
 const {dom,w,calls}=await page((path,opts)=>{
  if(path.endsWith('/blackboard'))return {manual_context:opts.method==='PUT'?JSON.parse(opts.body).manual_context:'用户备注'};
  if(path.endsWith('/messages')&&opts.method==='POST') {
   const body=JSON.parse(opts.body);
   assert.ok(Buffer.byteLength(body.content,'utf8')<=10000,'真实后端按UTF-8字节检查10KB');
   if(rejectOnce)throw Object.assign(new Error('消息内容过长'),{rejected:true});
   return {user_message:{id:'q'}};
  }
  if(path.includes('/messages?'))return [{id:'r',role:'assistant',reply_to:'q',content:'你好',status:'complete'}];
  return existing(path);
 });
 try{
  w.deliveryContext=()=>JSON.stringify({task:'任务',summary:{users:100},profileAnalysis:{rows:Array.from({length:24},()=>({label:'中文人群口径'.repeat(40),users:10}))}});
  await assert.rejects(w.deliveryAgent.send('你好'),/消息内容过长/);
  assert.equal(w.deliveryAgent.snapshot().currentQuestion,'');
  rejectOnce=false;
  await w.deliveryAgent.send('你好');
  const sent=calls.find(([p,b])=>p.endsWith('/messages')&&b)[1];assert.equal(sent.content,'你好');
  const blackboard=calls.find(([p,b])=>p.endsWith('/blackboard')&&b)[1].manual_context;
  assert.match(blackboard,/用户备注/);assert.match(blackboard,/summary/);assert.ok(Array.from(blackboard).length<=8000);
 }finally{dom.window.close();}
});
test('选择已有GPT或Claude时保持页面会话和历史，下一条派发给所选Agent',async()=>{
 let selected='a';
 const {dom,w,calls}=await page((path,opts)=>{
  if(path==='/api/agents')return [{id:'a',name:'投放agent',user_id:'u',machine_id:'m',status:'online',cli_tool:'claude'},{id:'gpt',name:'我的GPT',user_id:'u',machine_id:'m',status:'online',cli_tool:'codex'}];
  if(path==='/api/conversations/agent') {const body=JSON.parse(opts.body);if(body.select_agent)selected=body.agent_id;return {id:'c',peer_id:selected};}
  if(path.endsWith('/messages')&&opts.method==='POST')return {user_message:{id:'q'}};
  if(path.includes('/messages?'))return [{id:'r',role:'assistant',reply_to:'q',content:'已回答',status:'complete'}];
  return [];
 });
 try{
  await w.deliveryAgent.history();await w.deliveryAgent.selectAgent('gpt');
  assert.equal(w.deliveryAgent.snapshot().session.conversation.id,'c');
  assert.equal(w.deliveryAgent.snapshot().items[0].text,'已回答');
  await w.deliveryAgent.send('你好');
  assert.equal(calls.find(([path,body])=>path.endsWith('/messages')&&body)[1].agent_id,'gpt');
  await w.deliveryAgent.reconnect();assert.equal(w.deliveryAgent.snapshot().session.agent.id,'gpt');
 }finally{dom.window.close();}
});

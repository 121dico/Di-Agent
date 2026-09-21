'use strict';
const {test}=require('node:test'); const assert=require('node:assert/strict');
const {createClaudeModelControls}=require('../claude-model-controls');
const cfg=model=>({version:2,model,approval_mode:'auto',reasoning_effort:'medium',service_tier:'default'});
test('native Claude selection preserves aliases, returns to default, and recovers retired choices before prompt',async()=>{
 const calls=[]; const notices=[]; let controls;
 const child={stdin:{write(line){const msg=JSON.parse(line);calls.push(msg.request);queueMicrotask(()=>controls.handleLine(JSON.stringify({type:'control_response',response:{request_id:msg.request_id,subtype:msg.request.model==='retired'?'error':'success',error:msg.request.model==='retired'?'unknown model':undefined,response:msg.request.subtype==='initialize'?{models:[{value:'sonnet'},{value:'default'}]}:{}}})));}}};
 controls=createClaudeModelControls(child,text=>notices.push(text));
 await controls.apply(cfg('sonnet')); await controls.apply(cfg('')); await controls.apply(cfg('retired'));
 assert.deepEqual(calls.filter(c=>c.subtype==='set_model').map(c=>c.model),['sonnet',null,'retired',null]);
 assert.equal(notices.length,1);assert.equal(calls.every(c=>c.subtype!=='user'),true);
 assert.throws(()=>controls.apply({...cfg('sonnet'),approval_mode:'full'}),/仅支持模型/);
});
test('Claude configuration failure times out before a prompt can be sent',async()=>{
 const controls=createClaudeModelControls({stdin:{write(){}}},()=>{},5);
 await assert.rejects(controls.apply(cfg('sonnet')),/超时/);
});

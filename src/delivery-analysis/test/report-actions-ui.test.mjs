import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {MODULES} from '../server/analysis-tasks.mjs';
const root=new URL('../app/',import.meta.url);
test('关闭新建任务后迟到的目录响应不能覆盖模块配置弹窗',async()=>{
 const dom=new JSDOM(await readFile(new URL('index.html',root),'utf8'),{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,d=w.document;
 const task={id:'coupon',sourceId:'coupon',name:'召回',purpose:'召回',builtin:true,modules:MODULES.map(m=>m.id)};
 let resolveSlow,calls=0;
 const catalog={items:[task],sources:[{id:'coupon',name:'召回源'}],modules:MODULES};
 w.state={data:{analysisTask:task,task:{id:'coupon'},moduleOptions:MODULES,status:{}}};w.deliveryLive={selection:()=>({taskId:'coupon'})};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async()=>{calls++;if(calls===2)await new Promise(r=>resolveSlow=r);return {ok:true,json:async()=>catalog};};
 try{
  w.eval(await readFile(new URL('report-actions.js',root),'utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,5));
  d.getElementById('createTask').click();await new Promise(r=>setTimeout(r,5));d.getElementById('infoDialog').close();d.getElementById('configureReportModules').click();
  assert.ok(d.getElementById('moduleForm'));resolveSlow();await new Promise(r=>setTimeout(r,10));
  assert.equal(d.getElementById('dialogTitle').textContent,'配置分析模块');assert.ok(d.getElementById('moduleForm'));assert.equal(d.getElementById('newAnalysisTaskForm'),null);
 }finally{dom.window.close();}
});
for(const operation of ['save','create'])test(operation+' 迟到提交只保存结果，不关闭或改写新弹窗',async()=>{
 const dom=new JSDOM(await readFile(new URL('index.html',root),'utf8'),{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,d=w.document;
 const task={id:'coupon',sourceId:'coupon',name:'召回',purpose:'召回',builtin:true,modules:MODULES.map(m=>m.id)};
 let complete,navigations=0;
 const catalog={items:[task],sources:[{id:'coupon',name:'召回源'}],modules:MODULES};
 w.state={data:{analysisTask:task,task:{id:'coupon'},moduleOptions:MODULES,status:{}}};w.deliveryLive={selection:()=>({taskId:'coupon'}),load:async()=>{navigations++;}};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(path,opts)=>{if(['PATCH','POST'].includes(opts.method))await new Promise(r=>complete=r);return {ok:true,json:async()=>opts.method==='GET'?catalog:{item:{...task,id:operation==='save'?'coupon':'new-task'}}};};
 try{
  w.eval(await readFile(new URL('report-actions.js',root),'utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,5));
  d.getElementById(operation==='save'?'configureReportModules':'createTask').click();await new Promise(r=>setTimeout(r,5));
  if(operation==='create')d.getElementById('newTaskName').value='新的分析';
  d.getElementById(operation==='save'?'moduleForm':'newAnalysisTaskForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,5));d.getElementById('infoDialog').close();
  d.getElementById(operation==='save'?'createTask':'configureReportModules').click();await new Promise(r=>setTimeout(r,5));
  const replacement=d.getElementById(operation==='save'?'newAnalysisTaskForm':'moduleForm');assert.ok(replacement);
  complete();await new Promise(r=>setTimeout(r,10));
  assert.equal(d.getElementById('infoDialog').open,true);assert.equal(d.getElementById(replacement.id),replacement);assert.equal(navigations,0);
 }finally{dom.window.close();}
});


test('生成日报沿用真实快照导出，保留周期和日期并打开分日视图',async()=>{
 const dom=new JSDOM(await readFile(new URL('index.html',root),'utf8'),{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,d=w.document;
 const task={id:'coupon',sourceId:'coupon',name:'召回',purpose:'召回',builtin:true,modules:MODULES.map(m=>m.id)};
 let payload,filename;
 w.state={data:{builtAt:'snapshot-1',analysisTask:task,task:{id:'coupon',selectedDate:'2026-08-24'},moduleOptions:MODULES,status:{}}};
 w.deliveryLive={selection:()=>({taskId:'coupon',date:'2026-08-24',group:'control_group'}),view:()=>({phase:'pre',effect:'cumulative',period:'3',metric:'dailyReach'})};
 w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){filename=this.download;};
 w.fetch=async(path,opts)=>{
  if(path==='/api/export'){payload=JSON.parse(opts.body);return {ok:true,blob:async()=>new w.Blob(['report'])};}
  return {ok:true,json:async()=>({items:[task],sources:[{id:'coupon',name:'召回源'}],modules:MODULES})};
 };
 try{
  w.eval(await readFile(new URL('report-actions.js',root),'utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,5));
  d.getElementById('exportDailyReport').click();await new Promise(r=>setTimeout(r,5));
  assert.equal(payload.view.phase,'monitor');assert.equal(payload.view.effect,'daily');assert.equal(payload.view.period,'3');
  assert.equal(payload.selection.date,'2026-08-24');assert.equal(payload.selection.group,'control_group');assert.equal(payload.builtAt,'snapshot-1');
  assert.equal(filename,'投放日报-2026-08-24-召回.html');assert.match(d.getElementById('reportActionStatus').textContent,/日报已生成/);
 }finally{dom.window.close();}
});
test('同任务重新打开配置时，上一份保存完成前不允许再次提交',async()=>{
 const dom=new JSDOM(await readFile(new URL('index.html',root),'utf8'),{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,d=w.document;
 const task={id:'coupon',sourceId:'coupon',name:'召回',modules:MODULES.map(m=>m.id)};
 let complete,patches=0;
 w.state={data:{analysisTask:task,task:{id:'coupon'},moduleOptions:MODULES,status:{}}};w.deliveryLive={selection:()=>({taskId:'coupon'})};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(path,opts)=>{if(opts.method==='PATCH'){patches++;await new Promise(r=>complete=r);return {ok:true,json:async()=>({item:{...task,modules:JSON.parse(opts.body).modules}})};}return {ok:true,json:async()=>({items:[],sources:[],modules:MODULES})};};
 const submit=()=>d.getElementById('moduleForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 const select=id=>d.querySelectorAll('#moduleForm input').forEach(n=>n.checked=n.value===id);
 try{
  w.eval(await readFile(new URL('report-actions.js',root),'utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,5));
  d.getElementById('configureReportModules').click();select('audienceProfile');submit();d.getElementById('infoDialog').close();
  d.getElementById('configureReportModules').click();select('effectOverview');submit();assert.equal(patches,1);assert.match(d.getElementById('reportFormFeedback').textContent,/正在保存/);
  complete();await new Promise(r=>setTimeout(r,5));assert.equal(d.getElementById('infoDialog').open,true);
  submit();assert.equal(patches,2);complete();await new Promise(r=>setTimeout(r,5));assert.deepEqual(Array.from(w.state.data.analysisTask.modules),['effectOverview']);
 }finally{w.close();}
});

test('任务树新增人群分析可搜索、配置、保存并打开；保存中不覆盖其他弹窗',async()=>{
 const dom=new JSDOM(await readFile(new URL('index.html',root),'utf8'),{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,d=w.document;
 const task={id:'coupon',sourceId:'coupon',name:'召回',purpose:'召回',builtin:true,modules:MODULES.map(m=>m.id)};
 let saved,opened;
 const child={...task,id:'child-1',builtin:false,parentId:'coupon',crowdId:'1011337400',name:'配置人群'};
 w.state={data:{analysisTask:task,task:{id:'coupon',kind:'coupon',cumulative:{startDate:'2026-08-12'}},moduleOptions:MODULES,status:{}}};
 w.deliveryLive={selection:()=>({taskId:'coupon'}),load:async selection=>{opened=selection;}};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(path,opts)=>{if(opts.method==='POST'){saved=JSON.parse(opts.body);return {ok:true,json:async()=>({item:child})};}return {ok:true,json:async()=>path.includes('crowds')?{items:[{id:'1011337400',name:'私家车流失30-60天'}],note:'已核验关联包目录'}:{items:saved?[task,child]:[task],sources:[{id:'coupon',name:'召回源',kind:'coupon'}],modules:MODULES}};};
 try{
  w.eval(await readFile(new URL('report-actions.js',root),'utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,5));
  d.querySelector('[data-add-audience-task="recall"]').click();await new Promise(r=>setTimeout(r,5));
  d.querySelector('[data-choose-crowd="1011337400"]').click();assert.equal(d.getElementById('analysisCrowdId').value,'1011337400');
  d.getElementById('analysisName').value='配置人群';d.getElementById('analysisTarget').value='20';
  d.getElementById('audienceAnalysisForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,5));
  assert.equal(saved.effect.targetRate,0.2);assert.equal(saved.effect.startDate,'2026-08-12');assert.equal(saved.crowdId,'1011337400');assert.equal(opened.taskId,'child-1');
  assert.ok(d.querySelector('[data-task-group="recall"] [data-analysis-task="child-1"]'));assert.ok(d.querySelector('[data-manage-edit="child-1"]'));assert.ok(d.querySelector('[data-manage-delete="child-1"]'));
 }finally{w.close();}
});

test('分日子模块可以独立隐藏，保留趋势和分日页签',async()=>{
 const dom=new JSDOM(await readFile(new URL('index.html',root),'utf8'),{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,d=w.document;
 const task={id:'coupon',sourceId:'coupon',name:'召回',purpose:'召回',moduleVersion:2,modules:MODULES.map(m=>m.id).filter(id=>id!=='dailyFunnelPanel')};
 w.state={data:{analysisTask:task,task:{id:'coupon'},moduleOptions:MODULES,status:{}}};w.deliveryLive={selection:()=>({taskId:'coupon'})};
 w.fetch=async()=>({ok:true,json:async()=>({items:[task],sources:[],modules:MODULES})});
 try{w.eval(await readFile(new URL('report-actions.js',root),'utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,5));
  assert.ok(d.getElementById('dailyFunnelPanel').classList.contains('report-module-hidden'));
  assert.equal(d.getElementById('movementTrend').classList.contains('report-module-hidden'),false);
  assert.equal(d.querySelector('[data-effect-view="daily"]').hidden,false);
 }finally{w.close();}
});

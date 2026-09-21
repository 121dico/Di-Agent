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

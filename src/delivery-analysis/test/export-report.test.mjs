import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {fileURLToPath} from 'node:url';
import {exportReport} from '../server/export-report.mjs';
import {MODULES} from '../server/analysis-tasks.mjs';
const row={date:'2026-08-12',group_type:'treatment_group',users:10,records:10,coupon:6,coupon_repurchase:3};
const later={...row,date:'2026-08-13',users:20,coupon:10,coupon_repurchase:2};
const snapshot={version:1,builtAt:'2026-09-21T00:00:00Z',queries:[],tasks:[{id:'coupon',name:'召回任务',kind:'coupon',notes:['真实口径'],sourceName:'召回源',sourceId:'recall',sourceTaskId:'184765378',partition:'2026-09-16',metric:'复购率',dates:['2026-08-12','2026-08-13'],rows:[row,later],dimensions:{charge_life_cycle:[{...row,value:'老用户'},{...later,value:'新用户'}]}}]};
const report={id:'report-id',sourceId:'coupon',name:'九月报告 </script><script>window.injected=1</script>',purpose:'召回',modules:MODULES.map(m=>m.id)};
const appDirectory=fileURLToPath(new URL('../app',import.meta.url));
test('离线HTML不依赖网络，切换日期、表格与模块后数据仍正确',async()=>{
 const html=await exportReport({snapshot,analysisTask:report,input:{builtAt:snapshot.builtAt,selection:{taskId:report.id,date:'2026-08-12'},view:{phase:'monitor',effect:'daily'}},appDirectory});
 assert.doesNotMatch(html,/<script[^>]+src=|<link[^>]+rel="stylesheet"/i);
 const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e));
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'file:///report.html',virtualConsole:console,beforeParse(w){w.fetch=()=>{throw new Error('offline network call');};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};}});
 try{
  await new Promise(r=>setTimeout(r,50));const d=dom.window.document;
  assert.equal(dom.window.injected,undefined);
  assert.match(d.getElementById('dailyMetrics').textContent,/35.00%/);
  assert.equal(d.querySelector('#dailyFunnelVisual .funnel-stage:last-child strong').textContent,'3');
  assert.equal(d.getElementById('contextTaskName').textContent,report.name);
  d.querySelector('[data-live-date="2026-08-13"]').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,20));
  assert.match(d.getElementById('dailyMetrics').textContent,/35.00%/);
  assert.equal(d.querySelector('#dailyFunnelVisual .funnel-stage:last-child strong').textContent,'2');
  d.querySelector('[data-profile-view="table"]').click();assert.ok(d.querySelector('#profileBars table'));
  d.getElementById('configureReportModules').click();
  d.querySelector('input[value="experimentBalance"]').checked=false;
  d.getElementById('moduleForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,10));assert.ok(d.getElementById('experimentBalance').classList.contains('report-module-hidden'));
  d.querySelector('[data-live-select-crowd="1011337400"]').click();await new Promise(r=>setTimeout(r,20));
  assert.equal(dom.window.deliveryLive.selection().crowdId,'1011337400');
  assert.ok(dom.window.state.data.task.scopeUnavailable);assert.equal(dom.window.state.data.task.summary.users,undefined);
  assert.doesNotMatch(d.getElementById('dailyMetrics').textContent,/35.00%/);
  assert.equal(errors.length,0,errors.map(e=>e.message).join('\n'));
 }finally{dom.window.close();}
});
test('数据先于交互脚本到达时，首次日期筛选不会跳回导出时页签，关闭阶段不残留工具条',async()=>{
 const html=await exportReport({snapshot,analysisTask:report,input:{builtAt:snapshot.builtAt,selection:{taskId:report.id},view:{phase:'pre'}},appDirectory});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'file:///report.html'});
 try{
  await new Promise(r=>setTimeout(r,5));dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const script of dom.window.document.querySelectorAll('script:not([type])')){dom.window.eval(script.textContent);await new Promise(r=>setTimeout(r,5));}
  const d=dom.window.document;
  d.querySelector('[data-phase="monitor"]').click();d.querySelector('[data-effect-view="daily"]').click();
  d.querySelector('[data-live-date="2026-08-12"]').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,10));
  assert.equal(d.querySelector('#stageTabs .active').dataset.phase,'monitor');
  assert.equal(d.querySelector('#effectViewTabs .active').dataset.effectView,'daily');
  d.getElementById('configureReportModules').click();
  for(const input of d.querySelectorAll('#moduleForm input'))input.checked=input.value==='audienceProfile';
  d.getElementById('moduleForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(dom.window.getComputedStyle(d.getElementById('effectSettings')).display,'none');
  assert.equal(dom.window.getComputedStyle(d.getElementById('subview-effect')).display,'none');
 }finally{dom.window.close();}
});

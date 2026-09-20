import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const root=new URL('../app/',import.meta.url);
async function page(result,status=200,savedSelection=null) {
 const dom=new JSDOM(await readFile(new URL('index.html',root),'utf8'),{url:'http://localhost/',runScripts:'outside-only'});
 if(savedSelection)dom.window.sessionStorage.setItem('deliveryOriginalSelection',savedSelection);
 dom.window.fetch=async()=>({ok:status===200,json:async()=>result});
 for(const file of ['report-runtime.js','original-live.js'])dom.window.eval(await readFile(new URL(file,root),'utf8'));
 dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
 await new Promise(resolve=>setTimeout(resolve,30));
 return dom;
}
const summary={users:100,coupon:40,coupon_repurchase:10,full:30,full_repurchase:8,rate:.25,unmet:30};
const data={env:'live',builtAt:'2026-09-20T02:00:00Z',status:{},task:{id:'coupon',kind:'coupon',selectedDate:'2026-08-24',selectedGroup:'all',dimension:'charge_life_cycle',dimensionOptions:{charge_life_cycle:'生命周期'},metric:'发券后 7 日复购率',partition:'2026-09-16',portraitPartition:'2026-09-16',sourceTaskId:'184765378',notes:['同一进组日'],summary,portrait:[{value:'老用户',users:100}],distribution:[{value:'老用户',...summary}],portraitGroups:[{group:'treatment_group',users:55},{group:'control_group',users:45}],groupSummary:[],groupDaily:[],daily:[{date:'2026-08-24',...summary}],evidence:[]}};
test('原页面保留任务树、双列画像和分日模块，并绑定真实数据',async()=>{
 const dom=await page(data),d=dom.window.document;
 assert.equal(d.querySelectorAll('#taskTree .task-group').length,3);
 assert.ok(d.querySelector('.content-grid.two-col #audienceProfile'));
 assert.ok(d.querySelector('.content-grid.two-col #experimentBalance'));
 assert.match(d.querySelector('#preMetrics').textContent,/100/);
 assert.match(d.querySelector('#profileBars').textContent,/老用户/);
 d.querySelector('[data-phase="monitor"]').click();d.querySelector('[data-effect-view="daily"]').click();
 assert.notEqual(d.querySelector('#subview-effect').style.display,'none');
 assert.notEqual(dom.window.getComputedStyle(d.querySelector('#subview-movement')).display,'none');
 assert.match(d.querySelector('#dailyMetrics').textContent,/25.00%/);
 assert.doesNotMatch(d.querySelector('#dailyFunnelVisual').textContent,/曝光|点击/);
 d.querySelector('[data-daily-funnel-view="bar"]').click();
 assert.equal(d.querySelectorAll('#dailyFunnelVisual .funnel-bar-track').length,3);
 dom.window.close();
});
test('数据读取失败也保留原模块，且不展示导出页面的示例数值',async()=>{
 const dom=await page({error:'请先登录 DiAgent'},401),d=dom.window.document;
 assert.match(d.querySelector('#phaseAvailabilityNote').textContent,/请先登录/);
 for(const id of ['preMetrics','effectMetrics','dailyMetrics','realtimeMetrics','profileBars']) assert.doesNotMatch(d.querySelector('#'+id).textContent,/214,084|7.62%|107,042/);
 assert.ok(d.querySelector('#experimentBalance'));
 assert.doesNotMatch(d.querySelector('#experimentBalance').textContent,/0.29|均衡检查通过/);
 dom.window.close();
});

test('切换未接入人群时清除旧漏斗数据说明',async()=>{
 const dom=await page(data),d=dom.window.document;
 assert.match(d.querySelector('#dailyFunnelPanel .funnel-footnote').textContent,/30/);
 d.querySelector('[data-task-group="recall"] .audience-option').click();
 assert.doesNotMatch(d.querySelector('#dailyFunnelPanel').textContent,/完整发券 30/);
 assert.match(d.querySelector('#phaseAvailabilityNote').textContent,/组合筛选尚未接入/);
 dom.window.close();
});

test('成功读取后缺口明确为空，保留本地人群包字段布局',async()=>{
 const dom=await page(data),d=dom.window.document;
 for(const id of ['balanceDimensions','funnelVisual','breakdownVisual']){
  assert.match(d.getElementById(id).textContent,/暂无数据/);
  assert.doesNotMatch(d.getElementById(id).textContent,/正在读取/);
 }
 assert.equal(d.querySelectorAll('#audiencePackageMeta .package-meta-row').length,9);
 const idRow=[...d.querySelectorAll('.package-meta-row')].find(n=>n.textContent.includes('整体人群包 ID'));
 assert.equal(idRow.querySelector('strong').textContent,'—');
 assert.doesNotMatch(d.body.textContent,/DEMO-AUD|214,084|7\.62%|94\.2%|286,400/);
 dom.window.close();
});
test('未接入人群点击刷新后仍为空，不回退到上一任务数据',async()=>{
 const dom=await page(data),d=dom.window.document;
 const option=d.querySelector('[data-task-group="recall"] .audience-option');option.click();
 d.getElementById('refreshAnalysis').click();
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(dom.window.state.data,null);
 assert.ok(option.classList.contains('active'));
 assert.doesNotMatch(d.getElementById('dailyMetrics').textContent,/25.00%/);
 dom.window.close();
});

 test('空画像不等于真实零人，浏览器重载保留未接入选择',async()=>{
 const empty=structuredClone(data);empty.task.portrait=[];
 const dom=await page(empty),d=dom.window.document;
 assert.match(d.getElementById('preOverview').textContent,/人群暂无数据/);
 d.querySelector('[data-task-group="recall"] .audience-option').click();
 const saved=dom.window.sessionStorage.getItem('deliveryOriginalSelection');dom.window.close();
 const reloaded=await page(data,200,saved);
 assert.equal(reloaded.window.state.data,null);
 assert.ok(reloaded.window.document.querySelector('[data-task-group="recall"] .audience-option.active'));
 reloaded.window.close();
 });

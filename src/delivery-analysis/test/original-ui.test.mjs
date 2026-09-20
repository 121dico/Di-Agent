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

test('无数据仍保留原漏斗、均衡条形、趋势图和表格骨架',async()=>{
 const dom=await page({error:'数据不可用'},503),d=dom.window.document;
 assert.equal(d.querySelectorAll('#funnelVisual .funnel-stage').length,4);
 assert.equal(d.querySelectorAll('#dailyFunnelVisual .funnel-stage').length,4);
 assert.equal(d.querySelectorAll('#balanceDimensions .balance-dimension').length,4);
 assert.ok(d.querySelector('#profileBars svg'));
 assert.ok(d.querySelector('.movement-line-chart svg'));
 assert.ok(d.querySelector('.realtime-chart svg'));
 assert.ok(d.querySelector('#breakdownTable table'));
 assert.doesNotMatch(d.querySelector('#funnelVisual').textContent,/214,084|176,470|82.4%/);
 dom.window.close();
});
test('真实 Agent 桥接的历史抽屉关闭时隐藏，不散落在页尾',async(t)=>{
 const dom=await page(data),d=dom.window.document;
 const observers=[],Observer=dom.window.MutationObserver;
 dom.window.MutationObserver=class extends Observer{constructor(callback){super(callback);observers.push(this);}};
 t.after(()=>{observers.forEach(o=>o.disconnect());dom.window.close();});
 for(const link of d.querySelectorAll('link[rel="stylesheet"]')){
  const style=d.createElement('style');style.textContent=await readFile(new URL(link.getAttribute('href'),root),'utf8');d.head.appendChild(style);
 }
 dom.window.fetch=async()=>({ok:true,json:async()=>({data:[]})});
 dom.window.eval(await readFile(new URL('agent-bridge.js',root),'utf8'));
 const drawer=d.querySelector('.ai-memory-drawer');
 assert.ok(drawer);
 assert.equal(dom.window.getComputedStyle(drawer).position,'fixed');
 assert.equal(dom.window.getComputedStyle(drawer).display,'none');
 d.querySelector('.ask-detail-btn').click();
 assert.notEqual(dom.window.getComputedStyle(drawer).display,'none');
 d.querySelector('.ai-memory-drawer-close').click();
 assert.equal(dom.window.getComputedStyle(drawer).display,'none');
});

 test('缺数据的漏斗保持三种原有视图切换，不生成假数值',async()=>{
 const dom=await page(data),d=dom.window.document;
 d.querySelector('[data-funnel-view="bar"]').click();
 assert.equal(d.querySelectorAll('#funnelVisual .funnel-bar-track').length,4);
 d.querySelector('[data-funnel-view="table"]').click();
 assert.equal(d.querySelectorAll('#funnelVisual tbody tr').length,4);
 d.querySelector('[data-funnel-view="funnel"]').click();
 assert.equal(d.querySelectorAll('#funnelVisual .funnel-stage').length,4);
 assert.doesNotMatch(d.querySelector('#funnelVisual').textContent,/0%|100%|NaN/);
 dom.window.close();
 });

test('空画像的条形和表格模式在刷新后继续保持，真实漏斗条有颜色',async()=>{
 const empty=structuredClone(data);empty.task.portrait=[];
 const dom=await page(empty),d=dom.window.document;
 d.querySelector('[data-profile-view="table"]').click();
 assert.ok(d.querySelector('#profileBars table'));assert.equal(d.querySelector('#profileBars svg'),null);
 d.querySelector('#refreshAnalysis').click();await new Promise(r=>setTimeout(r,30));
 assert.ok(d.querySelector('#profileBars table'));
 d.querySelector('[data-profile-view="bar"]').click();assert.ok(d.querySelector('#profileBars .profile-bar-track'));
 d.querySelector('[data-daily-funnel-view="bar"]').click();
 const bar=d.querySelector('#dailyFunnelVisual .funnel-bar-track b');
 assert.equal(bar.style.background,'rgb(37, 99, 235)');assert.equal(bar.style.width,'100%');
 dom.window.close();
});

test('原配置入口可选择新增画像维度，数据说明列出字段用途和个人目标',async()=>{
 const value=structuredClone(data);
 Object.assign(value.task,{id:'effect',kind:'effect',portraitDimension:'charge_is_member_active',portraitDimensionOptions:{charge_life_cycle:'生命周期',charge_is_member_active:'会员有效标记'},portrait:[{value:'未知',users:20}],fieldCoverage:[{name:'effect-api',fields:[{name:'target_rate',label:'目标值',status:'已接入',purpose:'源表个人目标'}]}]});
 Object.assign(value.task.summary,{personalTarget:.12,personalRateMean:.14,personalRateMin:0,personalRateMax:2,rate_count:100,target_count:100});
 const dom=await page(value),d=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 assert.match(d.querySelector('#dailyMetrics').textContent,/个人目标 12.00%/);
 assert.match(d.querySelector('#profileDimensionTitle').textContent,/会员有效标记/);
 d.querySelector('#configureDimensions').click();
 assert.ok(d.querySelector('[data-live-portrait="charge_is_member_active"]'));
 d.querySelector('#closeDialog').click();
 d.querySelector('#openDataNote').click();
 assert.match(d.querySelector('#dialogBody').textContent,/target_rate/);
 assert.match(d.querySelector('#dialogBody').textContent,/源值超过 100%/);
 dom.window.close();
});

test('画像快捷按钮不覆盖分日效果维度',async()=>{
 const value=structuredClone(data);value.task.dimension='member_status';value.task.dimensionOptions.member_status='会员状态';
 const dom=await page(value),d=dom.window.document;
 let requested;
 dom.window.fetch=async url=>{requested=new URL(url,'http://localhost');return {ok:true,json:async()=>value};};
 d.querySelector('[data-profile-dimension="city"]').click();
 await new Promise(r=>setTimeout(r,30));
 assert.equal(requested.searchParams.get('dimension'),'member_status');
 assert.equal(requested.searchParams.get('portraitDimension'),'city_name');
 dom.window.close();
});

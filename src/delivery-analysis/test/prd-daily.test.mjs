import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const root=new URL('../app/',import.meta.url);
async function page(change=()=>{}){
 const summary={users:200,coupon:100,coupon_repurchase:50,rate:.5,unmet:50};
 const task={id:'coupon',kind:'coupon',selectedDate:'2026-08-24',selectedGroup:'all',dimension:'charge_life_cycle',dimensionOptions:{charge_life_cycle:'生命周期'},metric:'发券后7日复购率',partition:'2026-09-16',portraitPartition:'2026-09-16',sourceTaskId:'184765378',notes:[],summary,portrait:[{value:'老用户',users:200}],distribution:[{value:'老用户',...summary}],groupSummary:[],groupDaily:[],daily:[{date:'2026-08-23',users:100,rate:.1},{date:'2026-08-24',...summary}],evidence:[]};
 change(task);
 const dom=new JSDOM(await readFile(new URL('index.html',root),'utf8'),{url:'http://localhost/',runScripts:'outside-only'});
 dom.window.fetch=async()=>({ok:true,json:async()=>({env:'live',builtAt:'2026-09-21',status:{},task})});
 for(const file of ['report-runtime.js','original-live.js'])dom.window.eval(await readFile(new URL(file,root),'utf8'));
 dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
 await new Promise(r=>setTimeout(r,30));return dom;
}
test('第4.4条：指标卡展示周期日均，不随选中日期变成当天指标，缺目标不虚构',async()=>{
 const dom=await page();try{
 const d=dom.window.document,cards=[...d.querySelectorAll('#dailyMetrics .metric-card')];
 assert.match(cards[0].textContent,/日均进组人数/);assert.equal(cards[0].querySelector(':scope > strong').textContent,'150');
 assert.match(cards[1].textContent,/日均目标指标/);assert.equal(cards[1].querySelector(':scope > strong').textContent,'30.00%');
 assert.match(cards[2].textContent,/目标差异/);assert.equal(cards[2].querySelector(':scope > strong').textContent,'—');
 assert.match(d.querySelector('#dailyInvalidDate').textContent,/2026-08-24/);
 }finally{dom.window.close();}
});

test('近3日按日历范围截取，不用3条历史记录代替；缺失日期不补零',async()=>{
 const dom=await page(task=>{task.daily=[{date:'2026-08-01',users:900,rate:.9},{date:'2026-08-22',users:100,rate:.1},{date:'2026-08-24',users:200,rate:.5}];});
 try{const d=dom.window.document;d.querySelector('#dailyPeriodSelect').value='3';d.querySelector('#dailyPeriodSelect').dispatchEvent(new dom.window.Event('change'));
 assert.equal(d.querySelector('#dailyMetrics .metric-card > strong').textContent,'150');
 assert.doesNotMatch(d.querySelector('#dailyTrendVisual').textContent,/08-01/);
 assert.match(d.querySelector('#dailyTrendVisual').textContent,/08-23/);
 assert.equal(d.querySelectorAll('#dailyTrendVisual polyline').length,2);
 assert.ok(d.querySelector('#dailyFunnelPanel').compareDocumentPosition(d.querySelector('#movementTrend')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
 }finally{dom.window.close();}
});

test('第4.6条：查看依据打开可追溯明细，包含来源、日期、指标分母与缺失目标',async()=>{
 const dom=await page(task=>{task.sourceName='epower_platform.ads_delivery_coupon_funnel_di';task.evidence=[{queryId:'audit-123',sourceId:'coupon-source',durationMs:42,query:{fields:[{name:'duid',aggregation:'COUNT_DISTINCT'}],filters:[{name:'dt',value:'2026-09-16'}],group_by:['entry_dt']}}];});
 try{const d=dom.window.document;d.querySelector('#infoDialog').showModal=function(){this.setAttribute('open','');};d.querySelector('#showMovementEvidence').click();
 assert.ok(d.querySelector('#infoDialog').hasAttribute('open'));
 const evidence=d.querySelector('#dialogBody').textContent;assert.match(evidence,/ads_delivery_coupon_funnel_di/);assert.match(evidence,/2026-08-24/);assert.match(evidence,/领券人数/);assert.match(evidence,/audit-123/);assert.match(evidence,/尚未配置/);
 }finally{dom.window.close();}
});

test('自定义周期保留两端日期；空范围依据不残留旧日期指标',async()=>{
 const dom=await page();try{
 const d=dom.window.document,period=d.querySelector('#dailyPeriodSelect'),dates=d.querySelectorAll('#customDateRange input');
 period.value='custom';period.dispatchEvent(new dom.window.Event('change'));dates[0].value='2026-08-01';dates[1].value='2026-08-24';dates[1].dispatchEvent(new dom.window.Event('change'));
 const axis=d.querySelectorAll('#dailyTrendVisual .movement-svg-axis')[1].textContent;assert.match(axis,/08-01/);assert.match(axis,/08-24/);
 dates[0].value='2025-01-01';dates[1].value='2025-01-02';dates[1].dispatchEvent(new dom.window.Event('change'));
 d.querySelector('#infoDialog').showModal=function(){this.open=true;};d.querySelector('#showMovementEvidence').click();
 assert.match(d.querySelector('#dialogBody').textContent,/所选范围暂无数据/);assert.doesNotMatch(d.querySelector('#dialogBody').textContent,/50.00%|老用户/);
 }finally{dom.window.close();}
});

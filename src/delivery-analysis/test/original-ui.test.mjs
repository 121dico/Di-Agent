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
 for(const id of ['preMetrics','effectMetrics','dailyMetrics','profileBars']) assert.doesNotMatch(d.querySelector('#'+id).textContent,/214,084|7.62%|107,042/);
 assert.ok(d.querySelector('#experimentBalance'));
 assert.doesNotMatch(d.querySelector('#experimentBalance').textContent,/0.29|均衡检查通过/);
 dom.window.close();
});

test('尚未接入的人群入口置灰，点击不套用任务全量数据',async()=>{
 const dom=await page(data),d=dom.window.document;
 const button=d.querySelector('[data-task-group="recall"] .audience-option');
 assert.equal(button.disabled,true);assert.match(button.title,/组合筛选尚未接入/);
 button.click();assert.equal(dom.window.state.data.task.id,'coupon');
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
test('旧版保存的未接入选择刷新后保持空态，不回退到其他任务',async()=>{
 const saved=JSON.stringify({unsupported:'该人群未接入',unknownTask:'recall',unknownAudience:'私家车流失 30～60 天'});
 const dom=await page(data,200,saved),d=dom.window.document;
 d.getElementById('refreshAnalysis').click();await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(dom.window.state.data,null);
 assert.doesNotMatch(d.getElementById('dailyMetrics').textContent,/25.00%/);
 dom.window.close();
});

 test('空画像不等于真实零人，浏览器重载保留未接入选择',async()=>{
 const empty=structuredClone(data);empty.task.portrait=[];
 const dom=await page(empty),d=dom.window.document;
 assert.match(d.getElementById('preOverview').textContent,/人群暂无数据/);
 const saved=JSON.stringify({unsupported:'该人群未接入',unknownTask:'recall',unknownAudience:'私家车流失 30～60 天'});dom.window.close();
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
 assert.equal(d.querySelector('.realtime-chart'),null);
 assert.ok(d.querySelector('#breakdownTable table'));
 assert.doesNotMatch(d.querySelector('#funnelVisual').textContent,/214,084|176,470|82.4%/);
 dom.window.close();
});
test('投放悬浮问答默认收起，展开关闭保留草稿并恢复焦点',async(t)=>{
 const dom=await page(data),d=dom.window.document;
 const observers=[],Observer=dom.window.MutationObserver;
 dom.window.MutationObserver=class extends Observer{constructor(callback){super(callback);observers.push(this);}};
 t.after(()=>{observers.forEach(o=>o.disconnect());dom.window.close();});
 for(const link of d.querySelectorAll('link[rel="stylesheet"]')){
  const style=d.createElement('style');style.textContent=await readFile(new URL(link.getAttribute('href'),root),'utf8');d.head.appendChild(style);
 }
 dom.window.fetch=async()=>({ok:true,json:async()=>({data:[]})});
 dom.window.eval(await readFile(new URL('agent-bridge.js',root),'utf8'));
 dom.window.eval(await readFile(new URL('agent-widget.js',root),'utf8'));
 const drawer=d.querySelector('.delivery-agent-panel');
 assert.ok(drawer);
 assert.equal(dom.window.getComputedStyle(drawer).position,'fixed');
 assert.equal(dom.window.getComputedStyle(drawer).display,'none');
 d.querySelector('.delivery-agent-launcher').click();
 assert.notEqual(dom.window.getComputedStyle(drawer).display,'none');
 const input=d.querySelector('.delivery-agent-input');input.value='下次追问';
 d.querySelector('.delivery-agent-close').click();
 assert.equal(input.value,'下次追问');assert.equal(d.activeElement,d.querySelector('.delivery-agent-launcher'));
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
 const value=structuredClone(data);value.task.dimension='member_status';value.task.dimensionOptions.member_status='会员状态';value.task.dimensionOptions.city_name='城市';
 const dom=await page(value),d=dom.window.document;
 let requested;
 dom.window.fetch=async url=>{requested=new URL(url,'http://localhost');return {ok:true,json:async()=>value};};
 d.querySelector('[data-profile-dimension="city"]').click();
 await new Promise(r=>setTimeout(r,30));
 assert.equal(requested.searchParams.get('dimension'),'member_status');
 assert.equal(requested.searchParams.get('portraitDimension'),'city_name');
 dom.window.close();
});

test('累计原卡片与漏斗展示独立去重统计，移除实时页签',async()=>{
 const value=structuredClone(data);
 value.task.cumulative={startDate:'2026-08-12',endDate:'2026-08-24',observedThrough:'2026-09-16',metric:'累计领券后7日复购率',note:'跨日按DUID去重',selectedGroup:'all',dimension:'charge_life_cycle',groupOverlap:1,exclusiveDimension:true,summary:{users:150,coupon:80,full:70,full_repurchase:15,coupon_repurchase:20,success:20,eligible:80,unmet:60,rate:.25},groupSummary:[{group:'treatment_group',users:80,rate:.3},{group:'control_group',users:71,rate:.2}],distribution:[{value:'老用户',users:150,unmet:60,rate:.25}]};
 const dom=await page(value),d=dom.window.document;
 assert.equal(d.querySelector('[data-effect-view="realtime"]'),null);
 assert.equal(d.getElementById('subview-realtime'),null);
 assert.match(d.getElementById('effectMetrics').textContent,/150/);
 assert.match(d.getElementById('funnelVisual').textContent,/150/);
 assert.doesNotMatch(d.getElementById('funnelVisual').textContent,/曝光|点击/);
 assert.match(d.getElementById('breakdownTable').textContent,/老用户/);
 d.querySelector('[data-funnel-view="table"]').click();
 assert.match(d.getElementById('funnelVisual').textContent,/150/);
 dom.window.close();
});

test('自定义空日期范围清空全部分日结果，累计数据不受影响',async()=>{
 const dom=await page(data),d=dom.window.document;
 const period=d.getElementById('dailyPeriodSelect');period.value='custom';period.dispatchEvent(new dom.window.Event('change'));
 const inputs=[...d.querySelectorAll('#customDateRange input')];inputs[0].value='2025-01-01';inputs[1].value='2025-01-02';inputs[1].dispatchEvent(new dom.window.Event('change'));
 for(const id of ['dailyMetrics','dailyFunnelVisual','dailyBreakdownVisual','dailyInvalidList'])assert.doesNotMatch(d.getElementById(id).textContent,/25.00%|老用户|100/);
 assert.match(d.getElementById('dailyFunnelNote').textContent,/范围暂无数据/);
 dom.window.close();
});

test('原漏斗内展示Apollo历史参考，日期与空范围联动但不加入转化阶段',async()=>{
 const {experimentReference}=await import('../server/experiment-reference.mjs');
 const value=structuredClone(data);value.task.experimentReference=experimentReference(value.task);
 const dom=await page(value),d=dom.window.document;
 assert.match(d.querySelector('#dailyFunnelPanel .apollo-reference').textContent,/117,098/);
 assert.match(d.querySelector('#dailyFunnelPanel .apollo-reference').textContent,/2026-09-21.*非自动同步/s);
 assert.doesNotMatch(d.getElementById('dailyFunnelVisual').textContent,/117,098/);
 assert.equal(d.querySelectorAll('#dailyFunnelVisual .funnel-stage').length,3);
 value.task.selectedDate='2026-08-12';value.task.daily.unshift({date:'2026-08-12',...summary});
 d.getElementById('refreshAnalysis').click();await new Promise(r=>setTimeout(r,30));
 assert.match(d.querySelector('#dailyFunnelPanel .apollo-reference').textContent,/152,823/);
 assert.doesNotMatch(d.querySelector('#dailyFunnelPanel .apollo-reference').textContent,/117,098/);
 const period=d.getElementById('dailyPeriodSelect');period.value='custom';period.dispatchEvent(new dom.window.Event('change'));
 const dates=d.querySelectorAll('#customDateRange input');dates[0].value='2025-01-01';dates[1].value='2025-01-02';dates[1].dispatchEvent(new dom.window.Event('change'));
 await new Promise(r=>setTimeout(r,30));
 assert.equal(d.querySelector('#dailyFunnelPanel .apollo-reference').hidden,true);
 dom.window.close();
});

test('均衡原面板展示分组画像并能展开和查看口径，读取失败清除旧值',async()=>{
 const live=structuredClone(data);
 live.task.groupPortrait={basis:'current_snapshot',conclusion:null,partition:'2026-09-16',sourceName:'coupon-source',cohortDate:'2026-08-24',groups:[{group:'treatment_group',users:10},{group:'control_group',users:20}],dimensions:['charge_life_cycle','charge_freq_type','charge_duid_role_name_v2_type','member_status'].map(key=>({key,status:'available',maxShareGap:.3,values:[{value:'已知标签',groups:[{group:'treatment_group',users:8,share:.8},{group:'control_group',users:10,share:.5}]}]}))};
 const dom=await page(live),d=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 assert.match(d.querySelector('#experimentBalance .status-pill').textContent,/画像已接入/);
 const details=d.querySelector('#balanceDimensions details');details.querySelector('summary').click();
 assert.equal(details.open,true);assert.match(details.textContent,/8 人.*80.00%/);assert.match(details.textContent,/30.00.*百分点/);
 assert.match(d.querySelector('#experimentBalance').textContent,/2026-09-16.*2026-08-24/);
 assert.doesNotMatch(d.querySelector('#experimentBalance').textContent,/均衡检查通过|P值|p-value/);
 d.querySelector('#viewBalanceRule').click();assert.equal(d.querySelector('#infoDialog').open,true);assert.match(d.querySelector('#dialogBody').textContent,/不是投放前/);
 d.querySelector('#closeDialog').click();
 dom.window.fetch=async()=>({ok:false,json:async()=>({error:'读取失败'})});
 d.querySelector('#recheckBalance').click();await new Promise(resolve=>setTimeout(resolve,30));
 assert.doesNotMatch(d.querySelector('#experimentBalance').textContent,/80.00%|30.00|画像已接入/);
 dom.window.close();
});

test('Ditag三个人群在原目录展示并打开详情，不套用任务全量冒充包内效果',async()=>{
 const {crowdReferences}=await import('../server/crowd-reference.mjs');
 const live=structuredClone(data);live.task.crowdReferences=crowdReferences(live.task);
 const dom=await page(live),d=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 assert.equal(d.querySelectorAll('#audiencePackageMeta [data-live-crowd]').length,3);
 const metadata=[...d.querySelectorAll('#audiencePackageMeta .package-meta-row')];
 assert.match(metadata.find(n=>n.querySelector('span').textContent==='整体人群包 ID').textContent,/1011337400.*1011337415.*1011337424/);
 assert.match(metadata.find(n=>n.querySelector('span').textContent==='有效期结束').textContent,/2026-12-31/);
 assert.match(d.querySelector('#audiencePackageMeta').textContent,/2,458,957|2458957/);
 const button=d.querySelector('[data-task-group="recall"] .audience-option');
 assert.equal(button.disabled,false);button.click();
 assert.equal(d.querySelector('#infoDialog').open,true);assert.match(d.querySelector('#dialogBody').textContent,/1011337400/);
 assert.match(d.querySelector('#dialogBody').textContent,/V3|2026-08-11/);assert.match(d.querySelector('#dialogBody').textContent,/非自动同步/);
 assert.equal(dom.window.state.data.task.summary.users,100);assert.match(d.querySelector('#contextInputName').textContent,/进组日 2026-08-24.*任务 184765378/);
 d.querySelector('#closeDialog').click();
 dom.window.fetch=async()=>({ok:false,json:async()=>({error:'数据不可用'})});d.querySelector('#refreshAnalysis').click();await new Promise(resolve=>setTimeout(resolve,30));
 assert.doesNotMatch(d.querySelector('#audiencePackageMeta').textContent,/2,458,957|1011337400/);assert.equal(button.disabled,true);
 dom.window.close();
});

test('BOSS配置在原漏斗及包详情可见，组别过滤与错误清理不污染效果',async()=>{
 const {deploymentReference}=await import('../server/deployment-reference.mjs');
 const {crowdReferences}=await import('../server/crowd-reference.mjs');
 const live=structuredClone(data);live.task.deploymentReference=deploymentReference(live.task);live.task.crowdReferences=crowdReferences(live.task);
 const dom=await page(live),d=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 assert.match(d.querySelector('#dailyFunnelPanel .boss-reference').textContent,/6 条/);
 assert.match(d.querySelector('#dailyFunnelPanel .boss-reference').textContent,/2026-12-31.*2026-08-24/s);
 assert.match(d.querySelector('#dailyFunnelPanel .boss-reference').textContent,/5折5元.*8折5元/s);
 d.querySelector('[data-task-group="recall"] .audience-option').click();
 assert.match(d.querySelector('#dialogBody').textContent,/1533893795547197440/);assert.match(d.querySelector('#dialogBody').textContent,/1531348692446228480/);
 assert.doesNotMatch(d.querySelector('#dialogBody').textContent,/1533894165925072896/);
 d.querySelector('#closeDialog').click();
 live.task.selectedGroup='treatment_group';d.querySelector('#refreshAnalysis').click();await new Promise(resolve=>setTimeout(resolve,30));
 assert.match(d.querySelector('#dailyFunnelPanel .boss-reference').textContent,/3 条/);assert.doesNotMatch(d.querySelector('#dailyFunnelPanel .boss-reference').textContent,/1533893795547197440/);
 assert.match(d.querySelector('#dailyMetrics').textContent,/25.00%/);
 dom.window.fetch=async()=>({ok:false,json:async()=>({error:'读取失败'})});d.querySelector('#refreshAnalysis').click();await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(d.querySelector('#dailyFunnelPanel .boss-reference').hidden,true);assert.doesNotMatch(d.querySelector('#dailyFunnelPanel').textContent,/1531348692446228480/);
 dom.window.close();
});

test('画像配置可多选并记忆，二三级拆分与重置通过真实查询契约驱动',async()=>{
 const payload=structuredClone(data);
 const keys=['charge_life_cycle','charge_freq_type','city_name'];
 payload.task.portraitDimensionOptions={charge_life_cycle:'生命周期',charge_freq_type:'充电频次',city_name:'城市'};
 payload.task.profileCrossDimensions=keys;
 payload.task.profileAnalysis={status:'available',dimensions:[keys[0]],total:100,rows:[{values:['老用户'],users:100,share:1,parentShare:1}]};
 const dom=await page(payload),d=dom.window.document;let request='';
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 dom.window.fetch=async url=>{request=url;const path=new URL(url,'http://localhost').searchParams.get('profileDimensions').split(',');const result=structuredClone(payload);result.task.profileAnalysis={status:'available',basis:'joint_snapshot',dimensions:path,total:100,rows:[{values:path.map((_,i)=>['老用户','低频','北京'][i]),users:100,share:1,parentShare:1}]};return {ok:true,json:async()=>result};};
 assert.equal(d.querySelector('#addProfileDrill').disabled,false);
 d.querySelector('#addProfileDrill').click();
 d.querySelector('input[value="charge_freq_type"]').checked=true;d.querySelector('#confirmProfileDrill').click();
 await new Promise(r=>setTimeout(r,20));
 assert.match(request,/profileDimensions=charge_life_cycle%2Ccharge_freq_type/);
 assert.match(d.querySelector('#profileBars').textContent,/总体.*100.00%/);
 d.querySelector('#addProfileDrill').click();d.querySelector('input[value="city_name"]').checked=true;d.querySelector('#confirmProfileDrill').click();
 await new Promise(r=>setTimeout(r,20));
 assert.match(d.querySelector('#profileDrillPath').textContent,/生命周期 × 充电频次 × 城市/);
 assert.equal(d.querySelector('#addProfileDrill').disabled,true);
 d.querySelector('#resetProfileDrill').click();await new Promise(r=>setTimeout(r,20));
 assert.equal(d.querySelector('#profileDrillPath').textContent,'生命周期');
 d.querySelector('#configureDimensions').click();assert.equal(d.querySelectorAll('#dialogBody input[type="checkbox"]').length,3);
 d.querySelector('input[value="city_name"]').checked=false;d.querySelector('#confirmDimensions').click();
 await new Promise(r=>setTimeout(r,20));assert.equal(d.querySelectorAll('#dimensionTabs button').length,2);
 dom.window.close();
});

test('自然语言区分城市与城市分框，图例键盘可拆分，错误后清除联合结果',async()=>{
 const payload=structuredClone(data);
 payload.task.portraitDimensionOptions={charge_life_cycle:'生命周期',city_name:'城市',city_fenkuang:'城市分框',charge_region:'战区'};
 payload.task.profileCrossDimensions=Object.keys(payload.task.portraitDimensionOptions);
 payload.task.profileAnalysis={status:'available',dimensions:['charge_life_cycle'],total:100,rows:[{values:['老用户'],users:100}]};
 const dom=await page(payload),d=dom.window.document;let request='';
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 dom.window.fetch=async url=>{request=url;return {ok:true,json:async()=>payload};};
 const legend=d.querySelector('.profile-pie-item');legend.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.match(d.querySelector('#dialogTitle').textContent,/选择第 2 级维度/);d.querySelector('#closeDialog').click();
 d.querySelector('#dimensionPrompt').value='再看看城市分框和战区';d.querySelector('#addDimensionPrompt').click();await new Promise(r=>setTimeout(r,20));
 assert.equal(new URL(request,'http://localhost').searchParams.get('profileDimensions'),'city_fenkuang');
 assert.match(d.querySelector('#profileFeedback').textContent,/城市分框、战区/);
 d.querySelector('#dimensionPrompt').value='生命周期 × 城市 × 战区';d.querySelector('#addDimensionPrompt').click();await new Promise(r=>setTimeout(r,20));
 assert.equal(new URL(request,'http://localhost').searchParams.get('profileDimensions'),'charge_life_cycle,city_name,charge_region');
 d.querySelector('#dimensionPrompt').value='天气';d.querySelector('#addDimensionPrompt').click();assert.match(d.querySelector('#profileFeedback').textContent,/未识别/);
 dom.window.fetch=async()=>({ok:false,json:async()=>({error:'服务不可用'})});d.querySelector('#refreshAnalysis').click();await new Promise(r=>setTimeout(r,20));
 assert.equal(d.querySelector('#addProfileDrill').disabled,true);assert.doesNotMatch(d.querySelector('#profileBars').textContent,/老用户/);
 dom.window.close();
});

test('切换任务恢复各自画像路径，配置弹窗保留分日所有维度入口',async()=>{
 const payload=structuredClone(data);payload.task.portraitDimensionOptions={charge_life_cycle:'生命周期',city_name:'城市'};payload.task.dimensionOptions.city_name='城市';
 const dom=await page(payload),d=dom.window.document;const urls=[];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 dom.window.fetch=async url=>{const params=new URL(url,'http://localhost').searchParams;urls.push(params);const result=structuredClone(payload);result.task.id=params.get('taskId');result.task.kind=result.task.id;result.task.portraitDimension=params.get('portraitDimension')||'charge_life_cycle';return {ok:true,json:async()=>result};};
 d.querySelector('#configureDimensions').click();assert.ok(d.querySelector('[data-live-breakdown="city_name"]'));
 d.querySelector('input[value="charge_life_cycle"]').checked=false;d.querySelector('#confirmDimensions').click();await new Promise(r=>setTimeout(r,20));
 d.querySelector('[data-task="summer"]').click();await new Promise(r=>setTimeout(r,20));
 d.querySelector('[data-task="recall"]').click();await new Promise(r=>setTimeout(r,20));
 assert.equal(urls.at(-1).get('profileDimensions'),'city_name');assert.equal(d.querySelector('#dimensionTabs .active').textContent,'城市');
 dom.window.close();
});

test('画像清楚区分召回单日和安心充人群，保留Demo维度说明与来源核对入口',async()=>{
 const fixture=structuredClone(data);
 fixture.task.portraitDimension='charge_freq_type';
 fixture.task.portraitDimensionOptions={charge_life_cycle:'生命周期',charge_freq_type:'充电频次'};
 fixture.task.portrait=[{value:'近30日未下单用户',users:100}];
 fixture.task.portraitSource={sourceName:'epower_platform.ads_delivery_coupon_funnel_di',sourceId:'coupon-source',partition:'2026-09-16',filters:[{name:'dt',value:'2026-09-16'},{name:'source_task_id',value:'184765378'},{name:'entry_dt',value:'2026-08-24'}],fields:['charge_freq_type'],scope:'entry_day',group:'all'};
 const dom=await page(fixture),d=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 assert.match(d.querySelector('#profileScope').textContent,/进组日 2026-08-24/);
 assert.match(d.querySelector('#profileDimensionDefinition').textContent,/总充电频次/);
 assert.match(d.querySelector('#profileInsight').textContent,/进组日/);
 d.querySelector('#profileSourceDetails').click();
 assert.match(d.querySelector('#dialogBody').textContent,/ads_delivery_coupon_funnel_di/);
 assert.match(d.querySelector('#dialogBody').textContent,/charge_freq_type/);
 assert.match(d.querySelector('#dialogBody').textContent,/2026-08-24/);
 assert.doesNotMatch(d.querySelector('#profileBars').textContent,/214,084|端内网约车/);
 dom.window.close();
});

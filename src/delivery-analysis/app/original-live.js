// 保留原报表 DOM 与 CSS，仅更新现有数据槽和交互的数据来源。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const one = selector => document.querySelector(selector);
  const all = selector => Array.from(document.querySelectorAll(selector));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = value => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—';
  const pct = value => Number.isFinite(value) ? (100 * value).toFixed(2) + '%' : '—';
  const state = window.state;
  state.request = 0;
  let selection = {taskId:'effect'}, chart = 'pie', funnel = 'funnel', initialized = false;
  const dimensions = {lifecycle:'charge_life_cycle',orders:'charge_freq_type',frequency:'charge_freq_type',identity:'charge_duid_role_name_v2_type',membership:'member_status',member:'member_status',cityFrame:'city_fenkuang',warZone:'charge_region',city:'city_name'};
  const colors = ['#2563eb','#14b8a6','#f59e0b','#8b5cf6','#f97316','#64748b'];
  const groupName = (group, kind) => kind === 'coupon' ? (group === 'treatment_group' ? '实验组' : '对照组') : '来源 ' + group + ' 组';
  function text(selector, value) { const node = one(selector); if (node) node.textContent = value; }
  function notice(message) { $('phaseAvailabilityNote').textContent = message; $('phaseAvailabilityNote').classList.remove('hidden'); }
  function metric(id, cards) {
    all('#'+id+' .metric-card').forEach((node,index) => {
      const card = cards[index];
      if (card) node.querySelector('.metric-top span').textContent = card[0];
      node.querySelector(':scope > strong').textContent = card ? card[1] : '—';
      node.querySelector('small').textContent = card ? card[2] : '暂无数据';
    });
  }
  function table(headers, rows) {
    return '<table class="profile-table"><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
  }
  function banner(id, title, description) {
    text('#'+id+' .conclusion-copy h2',title); text('#'+id+' .conclusion-copy p',description);
  }
  function packageMeta(task) {
    text('#audiencePackageMeta .package-heading strong', task ? (task.kind === 'coupon' ? '任务全量 · '+task.sourceTaskId : '近30天安心充低频购买用户') : '暂无数据');
    const values = task ? {'分析类型':'来源分组统计','分析实体':'DUID','快照日期':task.portraitPartition,'人群时效性':'来源日快照'} : {};
    all('#audiencePackageMeta .package-meta-row').forEach(row => {
      row.querySelector('strong').textContent = values[row.querySelector(':scope > span').textContent] || '—';
    });
  }
  function emptyGaps() {
    const gaps = {
      balanceDimensions:'暂无数据 · 缺少投放前快照与分流配置',
      funnelVisual:'暂无数据 · 缺少资源位曝光、点击及阶段关联',
      breakdownVisual:'暂无数据 · 缺少跨日去重累计口径',
      breakdownTable:'暂无数据',
    };
    Object.entries(gaps).forEach(([id,message]) => {$(id).textContent=message;$(id).dataset.availability='empty';});
    text('.realtime-chart','暂无数据 · 缺少小时级效果数据');
    text('#subview-effect > .root-cause-panel .cause-list','暂无数据 · 缺少累计未达成人群');
    text('#funnelDefinitionNote','暂无数据 · 资源位口径待接入');
    text('#resourceFunnelPanel .funnel-footnote','阶段数据接入后展示转化漏斗。');
    text('.realtime-trend-panel .data-note','暂无数据 · 小时级数据尚未接入');
    text('.realtime-trend-panel .movement-line-legend','—');
  }
  function clearData(message) {
    for (const id of ['preMetrics','effectMetrics','dailyMetrics','realtimeMetrics']) metric(id,[]);
    for (const id of ['preOverview','effectOverview','movementOverview']) banner(id,'数据尚未就绪',message);
    for (const id of ['profileBars','breakdownVisual','breakdownTable','dailyBreakdownVisual','dailyBreakdownTable','dailyFunnelVisual','funnelVisual','balanceDimensions','dailyInvalidList']) $(id).textContent = message;
    for (const selector of ['.movement-line-chart','.realtime-chart','#subview-effect > .root-cause-panel .cause-list']) text(selector,message);
    text('.audience-summary > strong','—'); text('.audience-summary .soft-tag','等待数据');
    text('#breakdownVisualDefinition','累计标签拆解暂未接入');
    text('.realtime-trend-panel .data-note','小时级数据暂未接入');
    text('#profileInsight',message); text('#profileVisualCaption','等待数据');
    text('#experimentBalance .status-pill','尚未接入');
    text('#experimentBalance .balance-insight p','缺少投放前快照和已核验分流配置，暂不输出均衡结论。');
    text('#experimentBalance .balance-summary strong','均衡检查暂未接入');
    text('#experimentBalance .balance-note p','均衡检查尚未接入，暂不判断是否通过。');
    text('#experimentBalance .balance-summary p','保留原检查模块，待对应数据可用后接入。');
    text('#subview-effect > .root-cause-panel .cause-recommend p','累计归属和营销建议暂未接入。');
    for(const selector of ['#dailyFunnelNote','#dailyFunnelPanel .funnel-footnote','#dailyBreakdownPanel .data-note','#dailyInvalidDate'])text(selector,message);
    packageMeta(null);emptyGaps();
    text('#contextStatus',message); text('.sync-status','未加载');
    $('exportReport').disabled = true;
    state.ai.answer = null; window.render();
    document.documentElement.dataset.liveReady = 'true';
  }
  function profile(task) {
    const rows = task.portrait, total = rows.reduce((s,r)=>s+r.users,0), label = task.dimensionOptions[task.dimension];
    text('.audience-summary > strong',num(rows.length?total:null)); text('.audience-summary > span','DUID · 当前来源快照');
    text('.audience-summary .soft-tag','分区 '+task.portraitPartition);
    text('#profileDimensionTitle',label); text('#profileDrillPath',label);
    text('#profileDimensionDefinition','来源快照标签；不代表投放前状态');
    text('#profileVisualCaption',chart === 'table' ? '人数与占比' : '占比结构');
    text('#profileInsight',rows.length ? rows[0].value+'占比 '+pct(total ? rows[0].users/total : null)+'，共 '+num(rows[0].users)+' 人。' : '所选范围暂无画像数据');
    if (!rows.length) {$('profileBars').textContent='暂无数据';return;}
    if (chart === 'table') $('profileBars').innerHTML = table(['标签枚举','人数','占比'],rows.map(r=>[r.value,num(r.users),pct(total?r.users/total:null)]));
    else if (chart === 'bar') $('profileBars').innerHTML = '<div class="profile-bars">'+rows.map(r=>'<div class="profile-bar-row"><span>'+esc(r.value)+'</span><div class="profile-bar-track"><b style="width:'+(total?100*r.users/total:0)+'%"></b></div><strong>'+num(r.users)+'</strong><em>'+pct(total?r.users/total:null)+'</em></div>').join('')+'</div>';
    else {
      const pie = rows.slice(0,5);
      if (rows.length > 5) pie.push({value:'其他',users:rows.slice(5).reduce((s,r)=>s+r.users,0)});
      let offset = 0;
      const segments = pie.map((r,i)=>{const ratio = total ? 100*r.users/total : 0, start=offset; offset+=ratio;return '<circle class="profile-pie-segment" cx="80" cy="80" r="54" pathLength="100" stroke="'+colors[i]+'" stroke-dasharray="'+ratio+' '+(100-ratio)+'" stroke-dashoffset="'+(-start)+'"><title>'+esc(r.value)+' '+num(r.users)+' 人</title></circle>';}).join('');
      $('profileBars').innerHTML = '<div class="profile-pie-grid"><div class="profile-pie-chart"><svg class="profile-pie-ring" viewBox="0 0 160 160" aria-label="'+esc(label)+'占比结构"><circle class="profile-pie-track" cx="80" cy="80" r="54"></circle>'+segments+'</svg></div><div class="profile-pie-legend">'+pie.map((r,i)=>'<div class="profile-pie-item" tabindex="0"><i class="profile-pie-swatch" style="background:'+colors[i]+'"></i><strong>'+esc(r.value)+'</strong><small>'+num(r.users)+' · '+pct(total?r.users/total:null)+'</small></div>').join('')+'</div></div>';
    }
  }
  function selectedRows(task) {
    const period = $('dailyPeriodSelect').value;
    if (period !== 'custom') return task.daily.slice(-Number(period || 7));
    const dates = all('#customDateRange input').map(n=>n.value);
    return task.daily.filter(r=>r.date>=dates[0] && r.date<=dates[1]);
  }
  function daily(task) {
    const rows = selectedRows(task), s=task.summary, coupon=task.kind==='coupon', reach=$('dailyMetricSelect').value==='dailyReach';
    const metricName = reach ? '样本人数' : task.metric;
    banner('movementOverview',rows.length+' 个数据日 · '+metricName,task.notes.join(' '));
    metric('dailyMetrics',[[coupon?'所选进组日人数':'所选统计日人数',num(s.users),task.selectedDate],[task.metric,pct(s.rate),coupon?num(s.coupon_repurchase)+' / '+num(s.coupon):num(s.axc)+' / '+num(s.charge)],[coupon?'领券人数':'个人达标人数',num(coupon?s.coupon:s.achieved),'同一日期口径'],[coupon?'领券未复购人数':'个人未达标人数',num(s.unmet),'来源真实统计']]);
    text('#dailyChartTitle',metricName+'趋势');
    text('#movementTrend .movement-line-legend','各来源组独立统计 · 点击日期联动下方模块');
    const series = task.groupDaily?.length ? task.groupDaily : [{group:'整体',rows:task.daily}];
    const values = series.flatMap(g=>g.rows.filter(r=>rows.some(d=>d.date===r.date)).map(r=>reach?r.users:r.rate)).filter(Number.isFinite);
    const max = Math.max(reach?1:.01,...values)*1.1;
    let svg = '<svg viewBox="0 0 760 238" role="img" aria-label="分日效果趋势"><line x1="50" y1="190" x2="715" y2="190" stroke="#cbd5e1"/>';
    series.forEach((g,index)=>{
      const data=rows.map((r,i)=>{const value=g.rows.find(d=>d.date===r.date);return {date:r.date,x:50+i*650/Math.max(rows.length-1,1),value:value?(reach?value.users:value.rate):null};});
      svg+='<text x="'+(50+index*250)+'" y="18" fill="'+colors[index]+'" font-size="12">'+esc(g.group==='整体'?'整体':groupName(g.group,task.kind))+'</text>';
      svg+='<polyline fill="none" stroke="'+colors[index]+'" stroke-width="2" points="'+data.filter(p=>p.value!==null).map(p=>p.x+','+(185-150*p.value/max)).join(' ')+'"/>';
      svg+=data.filter(p=>p.value!==null).map(p=>'<circle cx="'+p.x+'" cy="'+(185-150*p.value/max)+'" r="5" fill="'+colors[index]+'" tabindex="0" role="button" data-live-date="'+esc(p.date)+'" aria-label="选择 '+esc(p.date)+'"><title>'+esc(p.date)+' · '+(reach?num(p.value):pct(p.value))+'</title></circle>').join('');
    });
    svg+=rows.map((r,i)=>'<text x="'+(50+i*650/Math.max(rows.length-1,1))+'" y="220" text-anchor="middle" font-size="10">'+r.date.slice(5)+'</text>').join('')+'</svg>';
    one('.movement-line-chart').innerHTML=rows.length?svg:'所选日期范围暂无数据';
    one('.movement-line-chart').setAttribute('aria-label',metricName+'趋势');
    const label=task.dimensionOptions[task.dimension];
    const breakdown=task.distribution;
    const maxRate=Math.max(.01,...breakdown.map(r=>r.rate||0));
    $('dailyBreakdownVisual').innerHTML=breakdown.map(r=>'<div class="breakdown-visual-row"><div class="breakdown-visual-label"><strong>'+esc(r.value)+'</strong><small>'+num(r.users)+' 人</small></div><div class="breakdown-rate"><div class="breakdown-rate-track"><b class="positive" style="width:'+100*(r.rate||0)/maxRate+'%"></b></div><strong>'+pct(r.rate)+'</strong></div></div>').join('');
    $('dailyBreakdownTable').innerHTML=table([label,'人数',task.metric,'未达成人数'],breakdown.map(r=>[r.value,num(r.users),pct(r.rate),num(r.unmet)]));
    text('#dailyBreakdownPanel .data-note',task.selectedDate+' · '+(task.selectedGroup==='all'?'整体':groupName(task.selectedGroup,task.kind)));
    text('#dailyInvalidTitle',coupon?'所选日领券未复购画像':'所选日未达标画像'); text('#dailyInvalidDate',task.selectedDate);
    $('dailyInvalidList').innerHTML=breakdown.filter(r=>r.unmet>0).sort((a,b)=>b.unmet-a.unmet).map((r,i)=>'<div class="cause-row"><span class="cause-index">'+String(i+1).padStart(2,'0')+'</span><span><strong>'+esc(r.value)+'</strong><small>'+num(r.unmet)+' 人 · '+pct(s.unmet?r.unmet/s.unmet:null)+'</small></span></div>').join('') || '所选范围暂无未达成人群';
    text('#dailyFunnelPanel .section-kicker',coupon?'发券复购漏斗':'阶段转化');
    text('#dailyFunnelNote',task.selectedDate+' · '+(coupon?'进组 → 领券 → 领券且复购；观察入组后第 1–7 天':'未提供曝光、点击或发券阶段数据'));
    text('#dailyFunnelPanel .funnel-footnote',coupon?'完整发券 '+num(s.full)+' 人，其中复购 '+num(s.full_repurchase)+' 人；独立子集，不拼入主漏斗。':'阶段漏斗待对应数据接入。');
    const stages=coupon?[['进组',s.users],['领券',s.coupon],['领券且 7 日复购',s.coupon_repurchase]]:[];
    const target=$('dailyFunnelVisual');target.className='funnel-visual view-'+funnel;
    if(!stages.length)target.textContent='该数据源暂无阶段漏斗';
    else if(funnel==='table')target.innerHTML=table(['阶段','人数','占进组比例'],stages.map(r=>[r[0],num(r[1]),pct(s.users?r[1]/s.users:null)]));
    else if(funnel==='bar')target.innerHTML='<div class="funnel-bar-list">'+stages.map((r,i)=>'<div class="funnel-bar-row"><div class="funnel-bar-label"><strong>'+esc(r[0])+'</strong><small>'+pct(s.users?r[1]/s.users:null)+'</small></div><div class="funnel-bar-track"><b style="width:'+100*r[1]/Math.max(s.users,1)+'%;background:'+colors[i]+'"></b></div><div class="funnel-bar-value"><strong>'+num(r[1])+'</strong></div></div>').join('')+'</div>';
    else target.innerHTML=stages.map((r,i)=>'<div class="funnel-stage '+(i===stages.length-1?'is-final':'')+'" style="--stage-width:'+Math.max(12,100*r[1]/Math.max(s.users,1))+'%;--stage-color:'+colors[i]+'"><span>'+esc(r[0])+'</span><strong>'+num(r[1])+'</strong><em>'+pct(s.users?r[1]/s.users:null)+'</em></div>').join('');
  }
  function renderData() {
    const d=state.data;if(!d)return;const t=d.task;
    const originalId=t.id==='coupon'?'recall':'summer';
    all('.task-node').forEach(n=>n.classList.toggle('active',n.dataset.task===originalId));
    all('.task-group').forEach(n=>n.classList.toggle('active',n.dataset.taskGroup===originalId));
    all('.audience-option').forEach(n=>n.classList.toggle('active',t.id==='effect'&&n.closest('.task-group').dataset.taskGroup==='summer'));
    all('.audience-option svg[data-lucide="check"]').forEach(n=>n.style.display=n.closest('.audience-option').classList.contains('active')?'':'none');
    text('#contextTaskName',one('[data-task="'+originalId+'"]').dataset.taskName);
    text('#contextInputName',t.id==='effect'?'近30天安心充低频购买用户':'任务全量 · '+t.sourceTaskId);
    text('#contextStatus','真实数据 · '+t.selectedDate);
    text('.mock-badge','服务器真实数据');text('.sync-status','快照 '+new Date(d.builtAt).toLocaleString('zh-CN',{hour12:false}));
    packageMeta(t);emptyGaps();
    text('#historyReference .data-note','当前目标：'+t.metric);
    notice((d.status.lastError?d.status.lastError+'；保留上次快照。':'')+t.notes.join(' '));
    const groups=t.portraitGroups || t.groupSummary;
    const total=t.portrait.reduce((sum,r)=>sum+r.users,0);
    metric('preMetrics',[['目标人群',num(t.portrait.length?total:null),'当前来源快照'],[groups[0]?groupName(groups[0].group,t.kind):'A组人数',num(groups[0]?.users),'来源分组'],[groups[1]?groupName(groups[1].group,t.kind):'B组人数',num(groups[1]?.users),'来源分组'],['均衡检查','—','投放前数据尚未接入']]);
    text('#preOverview .section-kicker','当前数据概览');
    banner('preOverview',t.portrait.length?'当前来源人群共 '+num(total)+' 人':'当前来源人群暂无数据','已接入画像与分日效果。投放前均衡检查、历史活动对比等待对应数据，不输出推测结论。');
    banner('effectOverview','跨日累计暂未接入','各日人数及滚动订单不可直接累加；请在原“分日效果”页签查看真实数据。');
    text('#effectSettings .baseline-label','累计口径');text('#baselineSelection','累计基准暂未接入');
    profile(t);daily(t);$('exportReport').disabled=false;
    for(const attr of ['profile-dimension','daily-breakdown'])all('[data-'+attr+']').forEach(n=>n.classList.toggle('active',dimensions[n.getAttribute('data-'+attr)]===t.dimension));
  }
  async function load(next=selection) {
    if(next.unsupported){unsupported(next.unsupported);return;}
    const changedTask=next.taskId!==selection.taskId;
    if(changedTask){all('#customDateRange input').forEach(n=>delete n.dataset.initialized);$('dailyPeriodSelect').value='7';$('customDateRange').classList.add('hidden');}
    const version=++state.request;selection=next;state.data=null;clearData('正在读取真实数据…');notice('正在读取真实数据…');
    try {
      const response=await fetch('/api/bootstrap?'+new URLSearchParams(next),{headers:{Authorization:'Bearer '+(localStorage.getItem('di_agent_token')||'')}});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'读取失败');
      if(version!==state.request)return;if(data.env!=='live')throw new Error('接口未返回真实数据');
      state.data=data;selection={taskId:data.task.id,date:data.task.selectedDate,group:data.task.selectedGroup,dimension:data.task.dimension};
      try{sessionStorage.setItem('deliveryOriginalSelection',JSON.stringify(selection));}catch{}
      text('#dailyMetricSelect option[value="firstOrderRate"]',data.task.metric);
      const dates=all('#customDateRange input');if(dates[0]&&data.task.daily.length&&!dates[0].dataset.initialized){dates[0].value=data.task.daily[0].date;dates[1].value=data.task.daily.at(-1).date;dates.forEach(n=>n.dataset.initialized='true');}
      renderData();
    }catch(error){if(version!==state.request)return;clearData(error.message);notice(error.message+'；请点击重新分析重试。');}
  }
  function unsupported(message) {
    ++state.request;selection={unsupported:message,unknownTask:one('.task-node.active')?.dataset.task,unknownAudience:one('.audience-option.active')?.dataset.audience};state.data=null;
    try{sessionStorage.setItem('deliveryOriginalSelection',JSON.stringify(selection));}catch{}
    clearData('暂无数据');notice(message);
  }
  function selectTree(node) {
    const group=node.closest('.task-group');
    all('.task-group').forEach(n=>n.classList.toggle('active',n===group));
    all('.task-node').forEach(n=>n.classList.toggle('active',group.contains(n)));
    all('.audience-option').forEach(n=>n.classList.toggle('active',n===node));
    all('.audience-option svg[data-lucide="check"]').forEach(n=>n.style.display=n.closest('.audience-option').classList.contains('active')?'':'none');
    text('#contextTaskName',group.querySelector('.task-node').dataset.taskName);
    text('#contextInputName',node.dataset.audience||'任务全量');
  }
  window.deliveryContext=()=>state.data?JSON.stringify({task:state.data.task.sourceTaskId,date:state.data.task.selectedDate,dimension:state.data.task.dimension,summary:state.data.task.summary,notes:state.data.task.notes}):'当前未选择已接入的数据';
  window.askAi=async question=>{state.ai={question,answer:{title:'分析暂不可用',answer:'当前没有可用 Agent，请先连接 Agent 后重试。'}};window.render();};
  function exportData(){if(!state.data)return;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(state.data,null,2)],{type:'application/json'}));a.href=url;a.download='投放分析-'+state.data.task.id+'.json';a.click();URL.revokeObjectURL(url);}
  function init() {
    if(initialized)return;initialized=true;
    // 原树和所有模块保留；不支持的组合只显示未接入，不能套用全量数据。
    text('.mock-badge','服务器真实数据');text('#toast','');
    text('[data-task="summer"] small','安心充权益 / 来源分组');
    all('[data-task-type]').forEach(n=>n.dataset.taskType=n.dataset.task==='summer'?'来源分组 / 真实数据':n.dataset.taskType);
    all('#dailyMetricSelect option').forEach(n=>{if(['exposureRate','clickRate'].includes(n.value)){n.disabled=true;n.textContent+='（未接入）';}});
    document.addEventListener('click',event=>{
      const n=event.target.closest('button,[data-live-date]');if(!n)return;
      if(n.dataset.task){event.stopImmediatePropagation();selectTree(n);const id={summer:'effect',recall:'coupon'}[n.dataset.task];if(id)load({taskId:id});else{unsupported('该任务尚未接入真实数据');text('#contextTaskName',n.dataset.taskName);}return;}
      if(n.classList.contains('audience-option')){event.stopImmediatePropagation();selectTree(n);if(n.closest('.task-group').dataset.taskGroup==='summer')load({taskId:'effect'});else{unsupported('该人群的组合筛选尚未接入，点击召回任务名称可查看任务全量数据。');text('#contextInputName',n.dataset.audience);}return;}
      if(n.dataset.profileDimension||n.dataset.dailyBreakdown){if(state.data)load({...selection,dimension:dimensions[n.dataset.profileDimension||n.dataset.dailyBreakdown]});}
      if(n.dataset.profileView){chart=n.dataset.profileView;renderData();}
      if(n.dataset.dailyFunnelView){funnel=n.dataset.dailyFunnelView;all('#dailyFunnelSwitch button').forEach(b=>b.classList.toggle('active',b===n));renderData();}
      if(n.dataset.liveDate&&state.data)load({...selection,date:n.dataset.liveDate});
      if(n.id==='refreshAnalysis'){event.stopImmediatePropagation();load();}
      if(n.id==='exportReport'){event.stopImmediatePropagation();exportData();}
      if(['openApiGuide','openDataNote','openHelp'].includes(n.id)) {
        event.stopImmediatePropagation();
        text('#dialogTitle',n.textContent.trim());
        const task=state.data?.task;
        $('dialogBody').innerHTML='<p>页面以服务器 API 聚合快照为准。有值展示真实统计，缺少数据展示 — 或暂无数据。</p>'+table(['模块','当前接入情况'],[
          ['人群画像、分日效果、单维度拆解','已接入；以所选任务和日期为准'],
          ['召回复购发券漏斗','已接入任务全量；分层人群组合暂无数据'],
          ['投放前均衡检查','暂无数据'],['跨日累计、目标与基准','暂无数据'],
          ['资源位曝光、点击','暂无数据'],['小时实时趋势','暂无数据'],['历史活动对比、下次投放建议','暂无数据'],
          ['人群包 ID、状态、有效期、创建人','暂无数据']
        ])+'<p>'+esc(task?'当前来源：'+task.sourceName+'；分区：'+task.partition+'。 '+task.notes.join(' '):'当前选择暂无已接入数据。')+'</p>';
        $('infoDialog').showModal();return;
      }
      if(n.id==='closeDialog'){$('infoDialog').close();return;}
      const evidence=['showConclusionEvidence','showMovementEvidence','showMonitorEvidence'];
      if(evidence.includes(n.id)){event.stopImmediatePropagation();notice(state.data?'来源 '+state.data.task.sourceName+'；分区 '+state.data.task.partition+'；'+state.data.task.evidence.length+' 次聚合查询，完整查询依据随导出保存。':'当前暂无查询依据');}
      const deferred=['addProfileDrill','configureDimensions','addDimensionPrompt','customBreakdownDimension','selectHistoryActivity','recheckBalance','viewBalanceRule','configureFunnel','exportDailyReport'];
      if(deferred.includes(n.id)){event.stopImmediatePropagation();notice('该能力所需数据或配置尚未接入；当前可使用原有画像维度和分日效果。');}
    },true);
    document.addEventListener('keydown',event=>{const n=event.target.closest('[data-live-date]');if(n&&['Enter',' '].includes(event.key)){event.preventDefault();if(state.data)load({...selection,date:n.dataset.liveDate});}});
    $('dailyPeriodSelect').onchange=()=>{$('customDateRange').classList.toggle('hidden',$('dailyPeriodSelect').value!=='custom');renderData();};
    $('dailyMetricSelect').onchange=renderData;all('#customDateRange input').forEach(n=>n.onchange=renderData);
    // 避免隐藏的历史示例被误认为真实结论。
    text('#historyReferenceEmpty p','历史活动数据尚未接入，保留原选择入口。');
    // 历史模块保留原有完整骨架；示例数值清空，尚无数据的结果继续隐藏。
    for (const id of ['historyReferenceResult','effectHistoryComparison']) {
      const region=$(id);
      region.querySelectorAll('p,td,strong,b,em,.lift,.soft-tag,.selected-history small,.history-note span').forEach(n=>{
        if (!n.closest('button') || n.matches('b,em,.lift')) n.textContent='—';
      });
      region.querySelectorAll('[style]').forEach(n=>n.style.removeProperty('width'));
    }
    text('#historyReferenceEmpty strong','暂无数据 · 历史活动尚未接入');
    text('#effectSelectedHistoryName','暂无数据');
    banner('effectHistoryComparison','历史活动暂未接入','等待历史数据后在原模块展示。');
    try{selection=JSON.parse(sessionStorage.getItem('deliveryOriginalSelection')||'null')||selection;}catch{}
    if(selection.unsupported){
      const group=all('.task-group').find(n=>n.dataset.taskGroup===selection.unknownTask);
      const node=group&&(Array.from(group.querySelectorAll('.audience-option')).find(n=>n.dataset.audience===selection.unknownAudience)||group.querySelector('.task-node'));
      if(node)selectTree(node);
    }
    load();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

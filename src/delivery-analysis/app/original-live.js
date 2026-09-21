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
  let selection = {taskId:'effect'}, chart = 'pie', funnel = 'funnel', resourceFunnel = 'funnel', initialized = false;
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
  // 保存已清空数字的原组件骨架。加载失败或切换未接入人群时恢复骨架，而非删掉图形。
  const emptyMarkup = new Map(all('[data-empty-visual]').map(node => [node.id,node.innerHTML]));
  function setVisual(id,html) {const node=$(id);node.removeAttribute('data-empty-visual');node.innerHTML=html;}
  function emptyVisual(id,message='暂无数据') {
    const node=$(id);if(!node)return;node.innerHTML=emptyMarkup.get(id);node.dataset.emptyVisual='true';
    const caption=node.querySelector('.visual-empty-caption');if(caption)caption.textContent=message;
  }
  function emptyProfile() {
    emptyVisual('profileBars');
    if(chart==='table')setVisual('profileBars',table(['标签枚举','人数','占比'],Array.from({length:3},()=>['—','—','—'])));
    if(chart==='bar')setVisual('profileBars','<div class="profile-bars">'+Array.from({length:3},()=>'<div class="profile-bar-row"><span>—</span><div class="profile-bar-track"></div><strong>—</strong><em>—</em></div>').join('')+'</div>');
    $('profileBars').dataset.emptyVisual='true';
  }
  function renderFunnel(id,stages,mode) {
    const empty=stages.every(r=>r[1]===null),total=stages[0]?.[1];
    const ratio=value=>Number.isFinite(value)&&total>0?value/total:null;
    const node=$(id);node.className='funnel-visual view-'+mode;node.setAttribute('aria-label',empty?'漏斗暂无数据':'真实阶段人数与首阶段占比');
    const stageColor=index=>id==='funnelVisual'?['#2563eb','#3b82f6','#14b8a6','#f97316'][index]:'#2563eb';
    let html;
    if(mode==='table')html=table(['阶段','人数','占首阶段比例'],stages.map(r=>[r[0],num(r[1]),pct(ratio(r[1]))]));
    else if(mode==='bar')html='<div class="funnel-bar-list">'+stages.map((r,i)=>'<div class="funnel-bar-row"><div class="funnel-bar-label"><strong>'+esc(r[0])+'</strong><small>'+pct(ratio(r[1]))+'</small></div><div class="funnel-bar-track"><b style="width:'+100*(ratio(r[1])||0)+'%;background:'+stageColor(i)+'"></b></div><div class="funnel-bar-value"><strong>'+num(r[1])+'</strong></div></div>').join('')+'</div>';
    else html=stages.map((r,i)=>'<button type="button" class="funnel-stage '+(i===stages.length-1?'is-final':'')+'" style="--stage-width:'+(empty?100-i*20:Math.max(12,100*(ratio(r[1])||0)))+'%;--stage-color:'+stageColor(i)+'"><span>'+esc(r[0])+'</span><strong>'+num(r[1])+'</strong><em>'+pct(ratio(r[1]))+'</em></button>').join('');
    setVisual(id,html);
    if(empty){node.dataset.emptyVisual='true';node.insertAdjacentHTML('beforeend','<div class="visual-empty-caption">暂无数据 · 保留图形结构，宽度不代表真实转化率</div>');}
  }
  const emptyStages = [['进组',null],['曝光',null],['点击',null],['达成效果',null]];
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
    Object.entries(gaps).forEach(([id,message]) => emptyVisual(id,message));
    renderFunnel('funnelVisual',emptyStages,resourceFunnel);
    emptyVisual('realtimeTrendVisual','暂无数据 · 缺少小时级效果数据');
    emptyVisual('cumulativeInvalidList','暂无数据 · 缺少累计未达成人群');
    text('#funnelDefinitionNote','暂无数据 · 资源位口径待接入');
    text('#resourceFunnelPanel .funnel-footnote','阶段数据接入后展示转化漏斗。');
    text('.realtime-trend-panel .data-note','暂无数据 · 小时级数据尚未接入');
    text('.realtime-trend-panel .movement-line-legend','—');
  }
  function clearData(message) {
    all('.apollo-reference').forEach(n=>{n.hidden=true;n.replaceChildren();});
    for (const id of ['preMetrics','effectMetrics','dailyMetrics','realtimeMetrics']) metric(id,[]);
    for (const id of ['preOverview','effectOverview','movementOverview']) banner(id,'数据尚未就绪',message);
    for (const id of emptyMarkup.keys()) emptyVisual(id,'暂无数据');
    renderFunnel('dailyFunnelVisual',emptyStages,funnel);emptyProfile();
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
    packageMeta(null);emptyGaps();$('configureFunnel').disabled=true;
    for(const id of ['breakdownGroupFilter','invalidGroupFilter'])$(id).classList.add('hidden');
    all('#baselineButtons button').forEach(b=>b.disabled=true);
    text('#contextStatus',message); text('.sync-status','未加载');
    $('exportReport').disabled = true;
    state.ai.answer = null; window.render();
    document.documentElement.dataset.liveReady = 'true';
  }
  function profile(task) {
    const rows = task.portrait, total = rows.reduce((s,r)=>s+r.users,0), label = (task.portraitDimensionOptions||task.dimensionOptions)[task.portraitDimension||task.dimension];
    text('.audience-summary > strong',num(rows.length?total:null)); text('.audience-summary > span','DUID · 当前来源快照');
    text('.audience-summary .soft-tag','分区 '+task.portraitPartition);
    text('#profileDimensionTitle',label); text('#profileDrillPath',label);
    text('#profileDimensionDefinition','来源快照标签；不代表投放前状态');
    text('#profileVisualCaption',chart === 'table' ? '人数与占比' : '占比结构');
    text('#profileInsight',rows.length ? rows[0].value+'占比 '+pct(total ? rows[0].users/total : null)+'，共 '+num(rows[0].users)+' 人。' : '所选范围暂无画像数据');
    if (!rows.length) {emptyProfile();return;}
    $('profileBars').removeAttribute('data-empty-visual');
    if (chart === 'table') $('profileBars').innerHTML = table(['标签枚举','人数','占比'],rows.map(r=>[r.value,num(r.users),pct(total?r.users/total:null)]));
    else if (chart === 'bar') $('profileBars').innerHTML = '<div class="profile-bars">'+rows.map(r=>'<div class="profile-bar-row"><span>'+esc(r.value)+'</span><div class="profile-bar-track"><b style="width:'+(total?100*r.users/total:0)+'%"></b></div><strong>'+num(r.users)+'</strong><em>'+pct(total?r.users/total:null)+'</em></div>').join('')+'</div>';
    else {
      const pie = rows.slice(0,5);
      if (rows.length > 5) pie.push({value:'其他',users:rows.slice(5).reduce((s,r)=>s+r.users,0)});
      let offset = 0;
      const segments = pie.map((r,i)=>{const ratio = total ? 100*r.users/total : 0, start=offset; offset+=ratio;return '<circle class="profile-pie-segment" cx="80" cy="80" r="54" pathLength="100" stroke="'+colors[i]+'" stroke-dasharray="'+ratio+' '+(100-ratio)+'" stroke-dashoffset="'+(-start)+'"><title>'+esc(r.value)+' '+num(r.users)+' 人</title></circle>';}).join('');
      $('profileBars').innerHTML = '<div class="profile-pie-grid"><div class="profile-pie-chart"><svg class="profile-pie-ring" viewBox="0 0 160 160" aria-label="'+esc(label)+'占比结构"><circle class="profile-pie-track" cx="80" cy="80" r="54"></circle>'+segments+'</svg><div class="profile-pie-detail" aria-live="polite"></div></div><div class="profile-pie-legend">'+pie.map((r,i)=>'<div class="profile-pie-item" tabindex="0"><i class="profile-pie-swatch" style="background:'+colors[i]+'"></i><strong>'+esc(r.value)+'</strong><small>'+num(r.users)+' · '+pct(total?r.users/total:null)+'</small></div>').join('')+'</div></div>';
    }
  }
  function renderExperimentReference(task,mode) {
    const panel=$(mode==='daily'?'dailyFunnelPanel':'resourceFunnelPanel');
    let node=panel.querySelector('.apollo-reference');
    if(!node){node=document.createElement('div');node.className='apollo-reference';panel.appendChild(node);}
    const ref=task.experimentReference;
    node.hidden=!ref || task.kind!=='coupon' || (mode==='daily'&&!selectedRows(task).some(r=>r.date===task.selectedDate));
    if(node.hidden){node.replaceChildren();return;}
    const group=mode==='daily'?task.selectedGroup:task.cumulative?.selectedGroup||'all';
    const groups=ref.groups.filter(g=>group==='all'||g.key===group);
    const records=mode==='daily'?ref.records.filter(r=>r.date===task.selectedDate):ref.records;
    const latest=records.at(-1);
    const headers=['日期',...groups.map(g=>g.name+'分流样本')];
    const values=rows=>rows.map(r=>[r.date,...groups.map(g=>num(r[g.key]))]);
    const latestLabel=mode==='daily'?'所选日期分流样本':'最后观测日分流样本（非累计）';
    node.innerHTML='<strong>Apollo 分流参考 · '+esc(ref.name)+'</strong><p>实验 '+esc(ref.experimentId)+' · '+esc(ref.toggle)+' · '+esc(ref.status)+' · 按 '+esc(ref.unit)+' 分流</p><p>'+groups.map(g=>esc(g.name)+' '+pct(g.allocation)+'：'+esc(g.strategy)).join('；')+'</p><p>'+esc(latestLabel)+'</p>'+(latest?table(headers,values([latest])):'<p>所选日期暂无已采集的 Apollo 分流记录</p>')+
      (mode==='daily'?'':'<details><summary>查看全部 '+records.length+' 个观测日</summary>'+table(headers,values(records))+'</details>')+
      '<p>'+esc(ref.scopeNote)+'</p><p class="apollo-source">采集日期 '+esc(ref.observedOn)+' · '+esc(ref.captureMode)+' · <a href="'+esc(ref.monitoringURL)+'" target="_blank" rel="noopener noreferrer">查看来源</a></p><details><summary>查看关联核对说明</summary><p>'+esc(ref.identityNote)+'</p><p>实验与三个召回人群包、BOSS配置的关联仍待核对；分流样本不等于领券或复购人数。</p></details>';
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
    renderExperimentReference(task,'daily');
    banner('movementOverview',rows.length+' 个数据日 · '+metricName,task.notes.join(' '));
    if(!rows.some(r=>r.date===task.selectedDate)) {
      metric('dailyMetrics',[]);
      for(const id of ['dailyTrendVisual','dailyBreakdownVisual','dailyBreakdownTable','dailyInvalidList'])emptyVisual(id,'所选日期范围暂无数据');
      renderFunnel('dailyFunnelVisual',emptyStages,funnel);
      for(const selector of ['#dailyFunnelNote','#dailyFunnelPanel .funnel-footnote','#dailyBreakdownPanel .data-note','#dailyInvalidDate'])text(selector,'所选日期范围暂无数据');
      return;
    }
    metric('dailyMetrics',[[coupon?'所选进组日人数':'所选统计日人数',num(s.users),task.selectedDate],[task.metric,pct(s.rate),coupon?num(s.coupon_repurchase)+' / '+num(s.coupon):num(s.axc)+' / '+num(s.charge)],[coupon?'领券人数':'个人达标人数',num(coupon?s.coupon:s.achieved),coupon?'同一日期口径':'个人目标 '+pct(s.personalTarget)],[coupon?'领券未复购人数':'个人未达标人数',num(s.unmet),coupon?'来源真实统计':'个人渗透率均值 '+pct(s.personalRateMean)]]);
    text('#dailyChartTitle',metricName+'趋势');
    text('#movementTrend .movement-line-legend','各来源组独立统计 · 点击日期联动下方模块');
    const series = task.groupDaily?.length ? task.groupDaily : [{group:'整体',rows:task.daily}];
    const values = series.flatMap(g=>g.rows.filter(r=>rows.some(d=>d.date===r.date)).map(r=>reach?r.users:r.rate)).filter(Number.isFinite);
    const max = Math.max(reach?1:.01,...values)*1.1;
    let svg='<svg viewBox="0 0 620 240" role="img" aria-label="分日效果趋势"><g class="movement-svg-grid">'+[28,86,144,202].map(y=>'<line x1="70" x2="590" y1="'+y+'" y2="'+y+'"></line>').join('')+'</g><g class="movement-svg-axis">'+[0,1,2,3].map(i=>'<text x="58" y="'+(32+i*58)+'" text-anchor="end">'+(reach?num(Math.round(max*(3-i)/3)):pct(max*(3-i)/3))+'</text>').join('')+'</g>';
    const legends=[];
    series.forEach((g,index)=>{
      const name=g.group==='整体'?'整体':groupName(g.group,task.kind);
      legends.push('<span><i style="background:'+colors[index]+'"></i>'+esc(name)+'</span>');
      const data=rows.map((r,i)=>{const item=g.rows.find(d=>d.date===r.date);return {date:r.date,x:70+i*520/Math.max(rows.length-1,1),value:item?(reach?item.users:item.rate):null};});
      // 缺测点必须断开，不能用直线补成已观测值。
      let points=[];
      const flush=()=>{if(points.length)svg+='<polyline class="movement-line-path '+(index?'movement-line-control':'')+'" style="stroke:'+colors[index]+'" points="'+points.join(' ')+'"></polyline>';points=[];};
      data.forEach(p=>{if(Number.isFinite(p.value))points.push(p.x+','+(202-174*p.value/max));else flush();});flush();
      svg+='<g class="'+(index?'movement-control-points':'movement-line-points')+'">'+data.filter(p=>Number.isFinite(p.value)).map(p=>'<circle cx="'+p.x+'" cy="'+(202-174*p.value/max)+'" r="'+(index?4:6)+'" style="fill:'+colors[index]+'" tabindex="0" role="button" data-live-date="'+esc(p.date)+'" aria-label="选择 '+esc(p.date)+'"><title>'+esc(p.date)+' · '+esc(name)+' '+(reach?num(p.value):pct(p.value))+'</title></circle>').join('')+'</g>';
    });
    one('#movementTrend .movement-line-legend').innerHTML=legends.join('');
    svg+='<g class="movement-svg-axis">'+rows.map((r,i)=>'<text x="'+(70+i*520/Math.max(rows.length-1,1))+'" y="226" text-anchor="middle">'+r.date.slice(5)+'</text>').join('')+'</g></svg>';
    if(rows.length)setVisual('dailyTrendVisual',svg);else emptyVisual('dailyTrendVisual','所选日期范围暂无数据');
    one('.movement-line-chart').setAttribute('aria-label',metricName+'趋势');
    const label=task.dimensionOptions[task.dimension];
    const breakdown=task.distribution;
    // 原版并排展示两个来源组；保留该布局，不改成另一种条形图。
    const pairs=(task.groupDistribution||[]).slice(0,2);
    const pairRate=(index,value)=>pairs[index]?.rows.find(row=>row.value===value)?.rate;
    const pairLabel=index=>pairs[index]?groupName(pairs[index].group,task.kind):'来源组 '+(index+1);
    const difference=value=>{const a=pairRate(0,value),b=pairRate(1,value);return Number.isFinite(a)&&Number.isFinite(b)?((a-b)*100).toFixed(2)+'pp':'—';};
    setVisual('dailyBreakdownVisual',breakdown.map(r=>'<div class="breakdown-visual-row"><div class="breakdown-visual-label"><strong>'+esc(r.value)+'</strong><small>'+num(r.users)+' 人 · '+pct(s.users?r.users/s.users:null)+' 占该日</small></div><div class="daily-pair-rates"><span>'+esc(pairLabel(0))+' <b>'+pct(pairRate(0,r.value))+'</b></span><span>'+esc(pairLabel(1))+' <b>'+pct(pairRate(1,r.value))+'</b></span></div><em>'+difference(r.value)+'</em></div>').join(''));
    setVisual('dailyBreakdownTable',table([label,'人数','占该日',pairLabel(0),pairLabel(1),'组间差异','整体 '+task.metric],breakdown.map(r=>[r.value,num(r.users),pct(s.users?r.users/s.users:null),pct(pairRate(0,r.value)),pct(pairRate(1,r.value)),difference(r.value),pct(r.rate)])));
    if(!breakdown.length){emptyVisual('dailyBreakdownVisual');emptyVisual('dailyBreakdownTable');}
    text('#dailyBreakdownPanel .data-note',task.selectedDate+' · '+(task.selectedGroup==='all'?'整体':groupName(task.selectedGroup,task.kind)));
    text('#dailyInvalidTitle',coupon?'所选日领券未复购画像':'所选日未达标画像'); text('#dailyInvalidDate',task.selectedDate);
    $('dailyInvalidList').removeAttribute('data-empty-visual');
    $('dailyInvalidList').innerHTML=breakdown.filter(r=>r.unmet>0).sort((a,b)=>b.unmet-a.unmet).map((r,i)=>'<div class="cause-row"><span class="cause-index">'+String(i+1).padStart(2,'0')+'</span><span><strong>'+esc(r.value)+'</strong><small>'+num(r.unmet)+' 人 · '+pct(s.unmet?r.unmet/s.unmet:null)+'</small></span></div>').join('') || '所选范围暂无未达成人群';
    text('#dailyFunnelPanel .section-kicker',coupon?'发券复购漏斗':'覆盖与个人达标');
    text('#dailyFunnelNote',task.selectedDate+' · '+(coupon?'进组 → 领券 → 领券且复购；观察入组后第 1–7 天':'样本覆盖 → 当日个人达标；不是曝光点击行为漏斗'));
    text('#dailyFunnelPanel .funnel-footnote',coupon?'完整发券 '+num(s.full)+' 人，其中复购 '+num(s.full_repurchase)+' 人；独立子集，不拼入主漏斗。':'达标人数沿用当日源标记，订单指标为近30天滚动值；未提供曝光、点击。');
    const stages=coupon?[['进组',s.users],['领券',s.coupon],['领券且 7 日复购',s.coupon_repurchase]]:[['当日样本覆盖',s.users],['当日个人达标',s.achieved??null]];
    renderFunnel('dailyFunnelVisual',stages.length?stages:emptyStages,funnel);
  }
  function cumulative(task) {
    const c=task.cumulative;if(!c)return;
    renderExperimentReference(task,'cumulative');
    const s=c.summary,coupon=task.kind==='coupon',label=task.dimensionOptions[c.dimension],rows=c.distribution;
    const range=c.startDate+' → '+c.endDate,selected=c.selectedGroup==='all'?'整体':groupName(c.selectedGroup,task.kind);
    const treatment=c.groupSummary.find(g=>/treatment|experiment/.test(g.group)),control=c.groupSummary.find(g=>g.group==='control'||g.group==='control_group');
    const difference=Number.isFinite(treatment?.rate)&&Number.isFinite(control?.rate)?((treatment.rate-control.rate)*100).toFixed(2)+'pp':'—';
    const overlap=c.groupOverlap>0?'各组人数合计比整体去重多 '+num(c.groupOverlap)+'，存在跨组重叠；仅作描述性比较。':'来源分组用于描述性比较。';
    banner('effectOverview',range+' · '+selected+'累计去重 '+num(s.users)+' 人',c.note+' '+overlap);
    metric('effectMetrics',[
      [coupon?'累计去重进组人数':'期间去重覆盖人数',num(s.users),range],
      [c.metric,pct(s.rate),num(s.success)+' / '+num(s.eligible)],
      [coupon?'累计领券人数':'期间曾达标人数',num(coupon?s.coupon:s.success),coupon?'跨进组日按DUID去重':'统计期内任一日达标'],
      [coupon?'领券后未复购人数':'期间从未达标人数',num(s.unmet),'当前范围内集合差'],
      [treatment?groupName(treatment.group,task.kind)+'累计效果':'来源组累计效果',pct(treatment?.rate),num(treatment?.users)+' 人'],
      [control?groupName(control.group,task.kind)+'累计效果':'另一来源组累计效果',pct(control?.rate),'前组减后组 '+difference],
    ]);
    text('#effectSettings .baseline-label','累计对比');text('#baselineSelection',selected+' · '+range+' · 统计截至 '+c.observedThrough);
    all('#baselineButtons button').forEach(b=>{b.disabled=b.dataset.baseline!=='control';b.classList.toggle('active',b.dataset.baseline==='control');b.title=b.disabled?'缺少对应基准数据，见数据范围说明':'';});
    for(const [id,attribute] of [['breakdownGroupFilter','breakdownGroup'],['invalidGroupFilter','invalidGroup']]){
      $(id).classList.remove('hidden');all('#'+id+' button').forEach(b=>{
        const key=b.dataset[attribute],g=key==='all'?'all':key==='experiment'?treatment?.group:control?.group;
        b.dataset.liveCumulativeGroup=g||'';b.disabled=!g;b.textContent=key==='all'?'整体':g?groupName(g,task.kind):'无对应组';b.classList.toggle('active',g===c.selectedGroup);
      });
    }
    text('#resourceFunnelPanel .section-kicker',coupon?'发券复购漏斗':'累计覆盖与达标');
    text('#resourceFunnelPanel h3',coupon?'进组 → 领券 → 7日复购':'期间覆盖 → 期间曾达标');
    text('#funnelDefinitionNote',range+' · '+selected+' · 按DUID独立去重');
    text('#resourceFunnelPanel .funnel-footnote',coupon?'完整发券 '+num(s.full)+' 人，其中完整发券后复购 '+num(s.full_repurchase)+' 人；这是主链子集。':'这是覆盖与达标集合关系，未提供曝光、点击数据。');
    renderFunnel('funnelVisual',coupon?[['累计进组',s.users],['累计领券',s.coupon],['领券后7日复购',s.success]]:[['期间去重覆盖',s.users],['期间曾达标',s.success]],resourceFunnel);
    text('#effectBreakdown h3','累计标签拆解');text('#drillPath',selected+' · '+label);text('#breakdownVisualTitle',label);
    text('#breakdownVisualDefinition',c.exclusiveDimension?'各标签人数互斥，按期间去重统计':'期间标签可变化，同一用户可计入多个标签，不可相加');
    const delta=r=>Number.isFinite(r.rate)&&Number.isFinite(s.rate)?((r.rate-s.rate)*100).toFixed(2)+'pp':'—';
    setVisual('breakdownVisual',rows.map(r=>'<div class="breakdown-visual-group"><div class="breakdown-visual-row"><div class="breakdown-visual-label"><strong>'+esc(r.value)+'</strong><small>'+num(r.users)+' 人 · '+pct(s.users?r.users/s.users:null)+'</small></div><div class="breakdown-rate"><div class="breakdown-rate-track"><b class="positive" style="width:'+100*(r.rate||0)+'%"></b></div><strong>'+pct(r.rate)+'</strong><em>'+delta(r)+'</em></div></div></div>').join(''));
    setVisual('breakdownTable',table([label,'累计去重人数','占所选范围',c.metric,'与整体差异'],rows.map(r=>[r.value,num(r.users),pct(s.users?r.users/s.users:null),pct(r.rate),delta(r)])));
    const invalid=rows.filter(r=>r.unmet>0).sort((a,b)=>b.unmet-a.unmet);
    setVisual('cumulativeInvalidList',invalid.length?invalid.map((r,i)=>'<div class="cause-row"><span class="cause-index">'+String(i+1).padStart(2,'0')+'</span><span><strong>'+esc(r.value)+'</strong><small>'+num(r.unmet)+' 人'+(c.exclusiveDimension?' · '+pct(s.unmet?r.unmet/s.unmet:null):' · 该标签内未达成')+'</small></span></div>').join(''):'当前范围未达成人数为 0');
    text('#subview-effect > .root-cause-panel .cause-recommend p',c.exclusiveDimension?'未达成人数为所选范围累计分母人群减累计成功人群；标签排名是描述性统计，不代表原因。':'标签随日期变化：人数表示该标签内未达成，不等于整个期间从未达成；标签间不可相加。');
    all('[data-breakdown-dimension]').forEach(b=>{const active=dimensions[b.dataset.breakdownDimension]===c.dimension;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});
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
    $('configureFunnel').disabled=!t.cumulative;profile(t);daily(t);cumulative(t);$('exportReport').disabled=false;
    for(const attr of ['profile-dimension','daily-breakdown'])all('[data-'+attr+']').forEach(n=>n.classList.toggle('active',dimensions[n.getAttribute('data-'+attr)]===(attr==='profile-dimension'?(t.portraitDimension||t.dimension):t.dimension)));
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
      state.data=data;selection={taskId:data.task.id,date:data.task.selectedDate,group:data.task.selectedGroup,dimension:data.task.dimension,...(data.task.cumulative?{cumulativeGroup:data.task.cumulative.selectedGroup,cumulativeDimension:data.task.cumulative.dimension}:{}),...(data.task.portraitDimension?{portraitDimension:data.task.portraitDimension}:{})};
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
  window.deliveryContext=()=>state.data?JSON.stringify({task:state.data.task.sourceTaskId,date:state.data.task.selectedDate,dimension:state.data.task.dimension,portraitDimension:state.data.task.portraitDimension,portrait:state.data.task.portrait.slice(0,50),portraitRowsTotal:state.data.task.portrait.length,audienceFacts:state.data.task.audienceFacts,summary:state.data.task.summary,cumulative:state.data.task.cumulative,experimentReference:state.data.task.experimentReference,notes:state.data.task.notes}):'当前未选择已接入的数据';
  window.askAi=async question=>{state.ai={question,answer:{title:'分析暂不可用',answer:'当前没有可用 Agent，请先连接 Agent 后重试。'}};window.render();};
  function exportData(){if(!state.data)return;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(state.data,null,2)],{type:'application/json'}));a.href=url;a.download='投放分析-'+state.data.task.id+'.json';a.click();URL.revokeObjectURL(url);}
  function fieldDetails(task) {
    const s=task.summary;
    let html='<h4>数据来源标识</h4><p>'+esc(task.sourceTaskId)+' · '+esc(task.partition)+'</p>';
    if(task.kind==='effect')html+='<h4>所选统计日 · 源表个人效果</h4>'+table(['项目','实际数据'],[
      ['统一个人目标',pct(s.personalTarget)],['目标非空人数',num(s.target_count)+' / '+num(s.users)],
      ['个人渗透率均值',pct(s.personalRateMean)],['个人渗透率非空人数',num(s.rate_count)+' / '+num(s.users)],
      ['个人渗透率原值范围',pct(s.personalRateMin)+' → '+pct(s.personalRateMax)],
      ['源值检查',s.personalRateMax>1?'源值超过 100%，需核查源表，未截断或改写':'以源表原值为准'],
    ])+'<p>个人目标只在非空覆盖全部样本且目标相同时显示；目标不一致或缺失时显示 —。个人均值与订单合计比率口径不同，不代替整体活动目标。</p>';
    const facts=task.audienceFacts;
    if(facts)html+='<h4>人群画像快照 · '+esc(facts.partition)+'</h4>'+table(['项目','实际数据'],[
      ['近30天安心充订单',num(facts.summary.axc)],['近30天充电订单',num(facts.summary.charge)],
      ['首单 ID 有值人数',num(facts.orderCoverage.first_axc_order_id)+' / '+num(facts.summary.users)],
      ['最近单 ID 有值人数',num(facts.orderCoverage.last_axc_order_id)+' / '+num(facts.summary.users)],
    ])+'<p>订单计数是当前人群快照的近30天汇总，不是投放后新增；订单 ID 仅校验非 NULL 且非空字符串，不拉取用户或订单明细。</p>';
    html+='<h4>三个 API 字段用途</h4><p>“已接入”表示已用于统计、画像、范围限定或质量校验，不代表所有 PRD 功能已完成。完整查询依据随导出保存。</p>';
    for(const source of task.fieldCoverage||[])html+='<h4>'+esc(source.name)+' · '+source.fields.filter(f=>f.status==='已接入').length+'/'+source.fields.length+'</h4>'+table(['字段','状态','用途'],source.fields.map(f=>[f.name,f.status,f.purpose]));
    return html;
  }
  function markUnavailable() {
    const pending=[
      ['#createTask,[data-add-audience-task],.audience-actions button','缺少任务/人群管理接口，见数据范围'],
      ['#configureReportModules','模块配置尚未实现'],
      ['#addProfileDrill,#resetProfileDrill,#addDimensionPrompt,[aria-label="用自然语言补充分析维度"]','组合画像及自然语言维度尚未实现'],
      ['#recheckBalance,#viewBalanceRule','缺少投放前快照及实验配置'],
      ['#selectHistoryActivity,#changeHistoryActivity,#viewHistoryMatch,#viewHistoryBreakdown,#historyFilter,#runHistory,#createCandidate,#viewSnapshot','缺少可比历史活动数据'],
      ['#exportDailyReport','日报格式与生成流程尚未实现；可导出当前聚合 JSON'],
      ['[data-task="activation"],[data-task-group="activation"] .audience-option','尚未接入该任务的数据'],
      ['[data-task-group="recall"] .audience-option','指定人群包的组合筛选尚未接入；可选任务全量和流失周期拆解'],
    ];
    pending.forEach(([selector,reason])=>all(selector).forEach(n=>{n.disabled=true;n.title=reason;n.dataset.unavailable=reason;}));
    all('.balance-dimension').forEach(n=>{n.removeAttribute('role');n.removeAttribute('tabindex');n.title='缺少投放前快照及实验配置';});
  }
  function init() {
    if(initialized)return;initialized=true;
    // 原树和所有模块保留；不支持的组合只显示未接入，不能套用全量数据。
    text('.mock-badge','服务器真实数据');text('#toast','');markUnavailable();$('configureFunnel').lastChild.textContent='查看口径';
    text('[data-task="summer"] small','安心充权益 / 来源分组');
    all('[data-task-type]').forEach(n=>n.dataset.taskType=n.dataset.task==='summer'?'来源分组 / 真实数据':n.dataset.taskType);
    all('#dailyMetricSelect option').forEach(n=>{if(['exposureRate','clickRate'].includes(n.value)){n.disabled=true;if(!n.textContent.includes('（未接入）'))n.textContent+='（未接入）';}});
    document.addEventListener('click',event=>{
      const n=event.target.closest('button,[data-live-date]');if(!n)return;
      if(n.classList.contains('funnel-stage')){event.stopImmediatePropagation();text('#dialogTitle',n.querySelector('span').textContent);$('dialogBody').innerHTML='<p>人数：'+esc(n.querySelector('strong').textContent)+'；占首阶段比例：'+esc(n.querySelector('em').textContent)+'</p><p>'+esc(n.closest('section').querySelector('.funnel-definition-note')?.textContent||'当前所选日期与人群范围')+'</p><p>基于源表阶段标记按 DUID 去重；此处展示集合关系，不代表新增订单或因果增量。</p>';$('infoDialog').showModal();return;}
      if(n.dataset.task){event.stopImmediatePropagation();selectTree(n);const id={summer:'effect',recall:'coupon'}[n.dataset.task];if(id)load({taskId:id});else{unsupported('该任务尚未接入真实数据');text('#contextTaskName',n.dataset.taskName);}return;}
      if(n.classList.contains('audience-option')){event.stopImmediatePropagation();selectTree(n);if(n.closest('.task-group').dataset.taskGroup==='summer')load({taskId:'effect'});else{unsupported('该人群的组合筛选尚未接入，点击召回任务名称可查看任务全量数据。');text('#contextInputName',n.dataset.audience);}return;}
      if(n.dataset.profileDimension||n.dataset.dailyBreakdown){if(state.data)load({...selection,...(n.dataset.profileDimension?{portraitDimension:dimensions[n.dataset.profileDimension]}:{dimension:dimensions[n.dataset.dailyBreakdown]})});}
      if(n.dataset.livePortrait&&state.data){event.stopImmediatePropagation();$('infoDialog').close();load({...selection,portraitDimension:n.dataset.livePortrait});return;}
      if(n.dataset.liveBreakdown&&state.data){event.stopImmediatePropagation();$('infoDialog').close();load({...selection,dimension:n.dataset.liveBreakdown});return;}
      if(n.id==='configureDimensions'){
        event.stopImmediatePropagation();const task=state.data?.task;
        if(!task){notice('当前没有可配置的真实数据');return;}
        const options=task.portraitDimensionOptions||task.dimensionOptions;
        text('#dialogTitle','选择画像与分日拆解维度');
        $('dialogBody').innerHTML='<p>'+ '画像使用来源标签快照，切换画像维度不改变分日效果维度。'+'</p><div class="profile-dimensions">'+Object.entries(options).map(([key,label])=>'<button type="button" class="secondary-button compact-button" data-live-portrait="'+esc(key)+'">'+esc(label)+'</button>').join('')+'</div>';
        $('dialogBody').insertAdjacentHTML('beforeend','<h4>分日效果拆解</h4><div class="profile-dimensions">'+Object.entries(task.dimensionOptions).map(([key,label])=>'<button type="button" class="secondary-button compact-button" data-live-breakdown="'+esc(key)+'">'+esc(label)+'</button>').join('')+'</div>');
        $('infoDialog').showModal();return;
      }
      if(n.dataset.profileView){chart=n.dataset.profileView;if(state.data)renderData();else emptyProfile();}
      if(n.dataset.dailyFunnelView){funnel=n.dataset.dailyFunnelView;all('#dailyFunnelSwitch button').forEach(b=>b.classList.toggle('active',b===n));if(state.data)renderData();else renderFunnel('dailyFunnelVisual',emptyStages,funnel);}
      if(n.dataset.funnelView){resourceFunnel=n.dataset.funnelView;all('#funnelViewSwitch button').forEach(b=>b.classList.toggle('active',b===n));if(state.data?.task.cumulative)cumulative(state.data.task);else renderFunnel('funnelVisual',emptyStages,resourceFunnel);}
      if(n.dataset.liveCumulativeGroup&&state.data){event.stopImmediatePropagation();load({...selection,cumulativeGroup:n.dataset.liveCumulativeGroup});return;}
      if(n.dataset.breakdownDimension&&state.data){event.stopImmediatePropagation();load({...selection,cumulativeDimension:dimensions[n.dataset.breakdownDimension]});return;}
      if(n.dataset.liveCumulativeDimension&&state.data){event.stopImmediatePropagation();$('infoDialog').close();load({...selection,cumulativeDimension:n.dataset.liveCumulativeDimension});return;}
      if(n.id==='customBreakdownDimension'&&state.data){
        event.stopImmediatePropagation();text('#dialogTitle','选择累计拆解维度');
        $('dialogBody').innerHTML='<p>当前支持单维度累计去重；三维交叉和逐级下钻尚待实现。</p>'+Object.entries(state.data.task.dimensionOptions).map(([key,label])=>'<button type="button" class="secondary-button compact-button" data-live-cumulative-dimension="'+esc(key)+'">'+esc(label)+'</button>').join('');
        $('infoDialog').showModal();return;
      }
      if(n.dataset.liveDate&&state.data)load({...selection,date:n.dataset.liveDate});
      if(n.id==='configureFunnel'&&state.data?.task.cumulative){
        event.stopImmediatePropagation();const t=state.data.task,c=t.cumulative,s=c.summary;
        text('#dialogTitle','当前漏斗口径与实际数据');
        $('dialogBody').innerHTML='<p>'+esc(c.startDate+' → '+c.endDate+'；'+c.note)+'</p>'+table(['阶段','累计去重人数'],t.kind==='coupon'?[['进组',num(s.users)],['领券',num(s.coupon)],['领券且7日复购',num(s.success)],['完整发券（子集）',num(s.full)],['完整发券后复购（子集）',num(s.full_repurchase)]]:[['期间覆盖',num(s.users)],['期间至少一次达标',num(s.success)],['期间从未达标',num(s.unmet)]])+'<p>每阶段由源表独立去重查询。曝光、点击尚无事件数据；自由编辑阶段SQL尚未实现。</p>';
        $('infoDialog').showModal();return;
      }
      if(n.id==='refreshAnalysis'){event.stopImmediatePropagation();load();}
      if(n.id==='exportReport'){event.stopImmediatePropagation();exportData();}
      if(['openApiGuide','openDataNote','openHelp'].includes(n.id)) {
        event.stopImmediatePropagation();
        text('#dialogTitle',n.textContent.trim());
        const task=state.data?.task;
        $('dialogBody').innerHTML='<p>页面以服务器 API 聚合快照为准。有值展示真实统计，缺少数据展示 — 或暂无数据。</p>'+table(['模块','当前接入情况'],[
          ['人群画像、分日效果、单维度拆解','已接入；以所选任务和日期为准'],
          ['召回复购发券漏斗','已接入任务全量；分层人群组合暂无数据'],
          ['投放前均衡检查','暂无数据'],['累计效果','跨日按DUID独立去重；支持分组、标签及真实漏斗'],['整体活动目标、大盘与历史基准','缺少对应配置或数据；源表个人目标不能替代'],
          ['资源位曝光、点击','暂无数据'],['历史活动对比、下次投放建议','暂无数据'],
          ['数据来源标识','已使用 crowd_id / source_task_id 限定数据；源标识见下方'],['人群包管理状态、有效期、创建人','暂无数据']
        ])+'<p>'+esc(task?'当前来源：'+task.sourceName+'；分区：'+task.partition+'。 '+task.notes.join(' '):'当前选择暂无已接入数据。')+'</p>';
        $('dialogBody').insertAdjacentHTML('beforeend','<h4>PRD 尚缺的6类数据/配置</h4>'+table(['类别','影响'],[
          ['人群包目录与管理信息','搜索人群、任务关联、包状态/有效期、修改删除'],['实验与活动配置','AB映射、稳定分组、整体目标、投放起止与节奏'],['投放前标签快照','实验均衡与前置画像'],['同口径大盘基准','大盘效果及差异'],['曝光点击事件','资源位曝光/点击漏斗与指标'],['可比历史活动','历史验证、变化差、历史基准']
        ])+'<p>组合下钻、自然语言加维度、日报、模块配置还缺实现。暂不可用入口已标明原因；置灰不代表需求已完成。投放期新增订单/收入另需增量订单口径。</p>');
        if(task)$('dialogBody').insertAdjacentHTML('beforeend',fieldDetails(task));
        $('infoDialog').showModal();return;
      }
      if(n.id==='closeDialog'){$('infoDialog').close();return;}
      const evidence=['showConclusionEvidence','showMovementEvidence','showMonitorEvidence'];
      if(evidence.includes(n.id)){event.stopImmediatePropagation();notice(state.data?'来源 '+state.data.task.sourceName+'；分区 '+state.data.task.partition+'；'+state.data.task.evidence.length+' 次聚合查询，完整查询依据随导出保存。':'当前暂无查询依据');}
      const deferred=['addProfileDrill','addDimensionPrompt','customBreakdownDimension','selectHistoryActivity','recheckBalance','viewBalanceRule','configureFunnel','exportDailyReport'];
      if(deferred.includes(n.id)){event.stopImmediatePropagation();notice('该能力所需数据或配置尚未接入；当前可使用原有画像维度和分日效果。');}
    },true);
    document.addEventListener('keydown',event=>{const n=event.target.closest('[data-live-date]');if(n&&['Enter',' '].includes(event.key)){event.preventDefault();if(state.data)load({...selection,date:n.dataset.liveDate});}});
    const updatePeriod=()=>{
      $('customDateRange').classList.toggle('hidden',$('dailyPeriodSelect').value!=='custom');
      const task=state.data?.task,rows=task?selectedRows(task):[];
      if(rows.length && !rows.some(r=>r.date===task.selectedDate))load({...selection,date:rows.at(-1).date});else renderData();
    };
    $('dailyPeriodSelect').onchange=updatePeriod;
    $('dailyMetricSelect').onchange=renderData;all('#customDateRange input').forEach(n=>n.onchange=updatePeriod);
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

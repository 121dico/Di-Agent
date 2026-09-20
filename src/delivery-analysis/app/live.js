(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=value=>Number.isFinite(value)?value.toLocaleString('zh-CN'):'—';
  const pct=value=>Number.isFinite(value)?(value*100).toFixed(2)+'%':'—';
  const groupName=(group,kind)=>group==='all'?'整体':kind==='coupon'?(group==='treatment_group'?'实验组':'对照组'):(group==='experiment'?'来源 experiment 组':'来源 control 组');
  const state=window.state={ai:{question:'',answer:null},data:null,phase:'monitor',view:'daily',chart:'pie',period:'14',request:0};
  let selection=Object.fromEntries(new URLSearchParams(location.search));
  if(!Object.keys(selection).length) {
    try { selection=JSON.parse(sessionStorage.getItem('deliverySelection')||'{}'); } catch { selection={}; }
  }
  window.esc=esc;
  window.render=()=>{
    const a=state.ai.answer;$('unifiedAiAnswer').classList.toggle('hidden',!a);
    $('unifiedAiAnswer').innerHTML=a?`<h3>${esc(a.title)}</h3><p>${esc(a.answer).replace(/\n/g,'<br>')}</p><small>${esc(a.scope||'')}</small>`:'';
  };
  window.deliveryContext=()=>state.data?JSON.stringify({task:state.data.task.name,date:state.data.task.selectedDate,group:state.data.task.selectedGroup,summary:state.data.task.summary,notes:state.data.task.notes,partition:state.data.task.partition,builtAt:state.data.builtAt,evidence:state.data.task.evidence.slice(0,3)}):'数据尚未就绪';
  window.askAi=async question=>{
    const t=state.data?.task;
    state.ai={question,answer:{title:'当前真实数据摘要',answer:t?`${t.name}，${t.selectedDate}，${groupName(t.selectedGroup,t.kind)}。\n${t.metric}：${pct(t.summary.rate)}；样本人数：${num(t.summary.users)}。\n${t.notes.join('\n')}\n未连接可用 Agent，仅返回当前数据摘要，尚未对问题进行推理。`:'数据尚未就绪，请先加载数据。',scope:t?.sourceName}};
    window.render();return state.ai.answer;
  };
  function table(headers,rows) {
    return `<div class="live-table-wrap"><table class="live-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">所选范围暂无数据</td></tr>`}</tbody></table></div>`;
  }
  function panel(title,description,body) {return `<section class="workspace-panel live-panel"><h3>${esc(title)}</h3><p>${esc(description)}</p>${body}</section>`;}
  function metrics(cards) {return `<div class="live-metrics">${cards.map(([label,value,note])=>`<div class="live-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note||'')}</small></div>`).join('')}</div>`;}
  function tabs(items,selected,action) {return `<div class="live-tabs">${items.map(([id,label])=>`<button type="button" data-${action}="${esc(id)}" class="${id===selected?'active':''}" aria-pressed="${id===selected}">${esc(label)}</button>`).join('')}</div>`;}
  function controls(t) {
    return `<div class="live-controls"><label>${t.kind==='coupon'?'进组日':'统计日'}<select id="dateSelect">${t.dates.map(d=>`<option ${d===t.selectedDate?'selected':''}>${esc(d)}</option>`).join('')}</select></label><label>查看分组<select id="groupSelect">${['all',...t.groups].map(g=>`<option value="${esc(g)}" ${g===t.selectedGroup?'selected':''}>${esc(groupName(g,t.kind))}</option>`).join('')}</select></label><label>画像维度<select id="dimensionSelect">${Object.entries(t.dimensionOptions).map(([key,label])=>`<option value="${esc(key)}" ${key===t.dimension?'selected':''}>${esc(label)}</option>`).join('')}</select></label></div>`;
  }
  function bars(items,key='users') {
    const max=Math.max(1,...items.map(r=>r[key]||0));
    return `<div class="live-bars">${items.slice(0,20).map(r=>`<div class="live-bar"><span>${esc(r.value)}</span><div class="live-bar-track"><div class="live-bar-fill" style="width:${100*(r[key]||0)/max}%"></div></div><strong>${num(r[key])}</strong></div>`).join('')}</div>`;
  }
  function portrait(t) {
    const rows=t.portrait,total=rows.reduce((s,r)=>s+r.users,0);
    let body='';
    if(state.chart==='table')body=table(['枚举','人数','占比'],rows.map(r=>[esc(r.value),num(r.users),pct(total?r.users/total:null)]));
    else if(state.chart==='bar')body=bars(rows);
    else {
      const colors=['#2f6fdb','#15857a','#a87a43','#7887a1','#966b9d','#a1afb7'];
      const pieRows=rows.slice(0,5);if(rows.length>5)pieRows.push({value:'其他（剩余枚举）',users:rows.slice(5).reduce((s,r)=>s+r.users,0)});
      let cursor=0;const stops=pieRows.map((r,i)=>{const from=cursor;cursor+=total?r.users/total*100:0;return `${colors[i]} ${from}% ${cursor}%`;});
      body=total?`<div class="live-pie-wrap"><div class="live-pie" role="img" aria-label="${esc(t.dimensionOptions[t.dimension])}人数分布" style="background:conic-gradient(${stops.join(',')})"></div><div class="live-legend">${pieRows.map((r,i)=>`<div title="${esc(r.value)}：${num(r.users)} 人"><i style="background:${colors[i]}"></i>${esc(r.value)}　${num(r.users)}　${pct(r.users/total)}</div>`).join('')}</div></div>`:'暂无可用画像';
    }
    return panel(t.dimensionOptions[t.dimension]+'分布',`画像分区 ${t.portraitPartition} · ${t.kind==='coupon'?'所选进组日样本的源表画像，并非投放前快照':'画像快照人群，独立于效果统计日'} · 分组筛选同步生效`,tabs([['pie','饼图'],['bar','条形图'],['table','数据表']],state.chart,'chart')+body);
  }
  function trend(rows) {
    const values=rows.map(r=>r.rate).filter(Number.isFinite);if(!values.length)return '<p>所选范围暂无可计算的指标。</p>';
    const max=Math.max(.01,...values)*1.15;
    const points=rows.map((r,i)=>({x:50+i*680/Math.max(rows.length-1,1),y:170-(r.rate||0)/max*140,...r}));
    return `<svg class="live-chart" viewBox="0 0 780 220" role="img" aria-label="每日效果趋势，详细数值见下表"><line x1="50" y1="170" x2="730" y2="170" stroke="#d8d8d4"/><text x="4" y="30" fill="#686b70" font-size="12">${pct(max)}</text><text x="18" y="170" fill="#686b70" font-size="12">0%</text><polyline points="${points.filter(p=>p.rate!==null).map(p=>`${p.x},${p.y}`).join(' ')}" fill="none" stroke="#2f6fdb" stroke-width="2"/>${points.map(p=>p.rate===null?'':`<circle cx="${p.x}" cy="${p.y}" r="4" fill="#2f6fdb"><title>${esc(p.date)}：${pct(p.rate)}</title></circle>`).join('')}<text x="50" y="205" fill="#686b70" font-size="12">${esc(rows[0].date)}</text><text x="660" y="205" fill="#686b70" font-size="12">${esc(rows.at(-1).date)}</text></svg>`;
  }
  function effects(t) {
    const s=t.summary,coupon=t.kind==='coupon';
    const cards=coupon?[
      ['进组人数',num(s.users),'所选进组日去重'],['领券人数',num(s.coupon),'至少收到一张对应券'],['发券后 7 日复购率',pct(s.rate),`${num(s.coupon_repurchase)} / ${num(s.coupon)}`],['领券未复购人数',num(s.unmet),'同一进组日、同一 7 日窗口'],
    ]:[['统计样本人数',num(s.users),'所选统计日'],['近 30 天订单渗透率',pct(s.rate),`${num(s.axc)} / ${num(s.charge)}`],['个人达标人数',num(s.achieved),'沿用源表个人目标判定'],['个人未达标人数',num(s.unmet),'沿用源表 unmet_flag']];
    let html=metrics(cards);
    html+=tabs([['daily','分日效果'],['selected','所选日期效果'],['cumulative','累计效果'],['realtime','实时效果'],['history','历史活动']],state.view,'view');
    if(['cumulative','realtime','history'].includes(state.view)) {
      const msg={cumulative:'跨日累计归属口径尚未确定。可先查看下方所选日期的真实效果，不将分日人数或滚动订单直接累加。',realtime:'尚未接入小时级数据，不能用日快照替代今日实时数据。',history:'历史活动对比尚未接入。'}[state.view];
      html+=panel('该模块暂未接入',msg,'');
    }
    if(state.view==='daily') {
      const rows=t.daily.slice(-Number(state.period));
      html+=panel('分日效果趋势',coupon?'按进组日观察后续 1–7 天的复购。点击日期联动下方漏斗和画像。':'每个统计日独立的近 30 天滚动订单比例；不能相加为每日新增订单。',
        tabs([['3','最近 3 个数据日'],['7','最近 7 个数据日'],['14','最近 14 个数据日']],state.period,'period')+trend(rows)+table([coupon?'进组日':'统计日','样本人数',t.metric,coupon?'领券人数':'个人达标人数',coupon?'领券未复购':'个人未达标'],rows.map(r=>[`<button data-date="${esc(r.date)}">${esc(r.date)}${r.date===t.selectedDate?' · 已选':''}</button>`,num(r.users),pct(r.rate),num(coupon?r.coupon:r.achieved),num(r.unmet)])));
    }
    html+=panel('分组效果',`${t.selectedDate} · ${coupon?'真实 Apollo 来源分组；差异为描述性结果，不表示统计显著性':'来源分组尚未验证为真实随机实验'}`,table(['分组','样本人数',t.metric,coupon?'整体 7 日复购率':'个人达标人数'],t.groupSummary.map(g=>[esc(groupName(g.group,t.kind)),num(g.users),pct(g.rate),coupon?pct(g.overallRate):num(g.achieved)])));
    if(coupon)html+=panel('发券与复购',`${t.selectedDate} · 发券后复购与完整发券后复购分别计算，不把互不包含的事件拼成连续漏斗。`,bars([{value:'进组',users:s.users},{value:'至少领一张券',users:s.coupon},{value:'完整发券',users:s.full},{value:'领券且 7 日复购',users:s.coupon_repurchase},{value:'完整发券且复购',users:s.full_repurchase}])+`<p>整体入组复购率 ${pct(s.overallRate)}（${num(s.repurchase)} / ${num(s.users)}），与领券样本复购率分别展示。</p>`);
    html+=panel('标签拆解',`${t.selectedDate} · ${groupName(t.selectedGroup,t.kind)} · 维度内独立统计`,table([t.dimensionOptions[t.dimension],'人数','占样本比例',t.metric,'相对整体差异'],t.distribution.map(r=>[esc(r.value),num(r.users),pct(s.users?r.users/s.users:null),pct(r.rate),r.rate!==null && s.rate!==null?((r.rate-s.rate)*100).toFixed(2)+' pp':'—'])));
    const unmet=t.distribution.filter(r=>r.unmet>0).sort((a,b)=>b.unmet-a.unmet);
    html+=panel(coupon?'领券未复购用户画像':'未达标用户画像',`${t.selectedDate} · ${coupon?'范围为已领券且未在观察窗口复购的用户':'沿用源表个人目标判定'} · 偏高倍数为未达成人群占比 / 对应观察人群占比。`,table([t.dimensionOptions[t.dimension],'未达成人数','未达成人群占比','相对观察人群倍数'],unmet.map(r=>{const baseline=s.eligible?r.eligible/s.eligible:0;return [esc(r.value),num(r.unmet),pct(s.unmet?r.unmet/s.unmet:null),baseline&&s.unmet?((r.unmet/s.unmet)/baseline).toFixed(2)+' 倍':'—'];})));
    return html;
  }
  function renderData() {
    if(!state.data)return;
    const d=state.data,t=d.task;
    $('taskTree').innerHTML=d.tasks.map(task=>`<button type="button" class="task-node ${task.id===t.id?'active':''}" data-task="${esc(task.id)}" aria-current="${task.id===t.id?'true':'false'}">${esc(task.name)}</button>`).join('');
    $('contextTaskName').textContent=t.name;$('contextInputName').textContent=t.sourceTaskId;
    $('contextStatus').textContent=`真实数据 · ${t.selectedDate}`;
    $('audiencePackageMeta').textContent=`数据分区：${t.partition}。${t.kind==='effect'?'安心充快照人群；来源分组尚未核验真实随机分流。':'召回实验；当前不包含投放前快照。'}`;
    $('syncStatus').textContent=`快照 ${new Date(d.builtAt).toLocaleString('zh-CN',{hour12:false})}`;
    const warning=(d.status.lastError?`<div class="live-warning">${esc(d.status.lastError)} · 当前展示 ${esc(d.builtAt)} 的快照</div>`:'')+(Date.now()-Date.parse(d.builtAt)>36*3600000?'<div class="live-warning">快照超过 36 小时未更新，请检查数据准备服务。</div>':'');
    const notes=`<div class="live-warning">${t.notes.map(esc).join('<br>')}</div>`;
    $('dataSurface').innerHTML=warning+controls(t)+notes+(state.phase==='pre'?portrait(t)+panel('投放前均衡与历史验证','当前仅有源表画像，未接入投放前快照与已核验实验分流配置，因此不输出“实验已均衡”的判断。',''):effects(t))+panel('数据与计算依据',`聚合快照：${d.builtAt}；分区：${t.partition}；筛选直接读取已发布聚合结果。`, `<details><summary>查看来源与查询记录（${t.evidence.length} 条）</summary><p>${esc(t.sourceName)} · ${esc(t.sourceId)}</p><div class="live-evidence">${t.evidence.map(e=>`<div>${esc(e.queryId)} · 第 ${num(e.page)} 页 · ${num(e.durationMs)} ms</div>`).join('')}</div></details>`);
    $('dateSelect').onchange=e=>load({...selection,date:e.target.value});
    $('groupSelect').onchange=e=>load({...selection,group:e.target.value});
    $('dimensionSelect').onchange=e=>load({...selection,dimension:e.target.value});
  }
  async function load(next=selection) {
    const request=++state.request;selection=next;state.data=null;
    $('dataSurface').innerHTML='<div class="workspace-panel live-empty">正在读取真实数据快照…</div>';
    $('exportReport').disabled=true;$('contextStatus').textContent='加载中';
    state.ai.answer=null;window.render();
    try {
      const token=localStorage.getItem('di_agent_token')||'';
      const response=await fetch('/api/bootstrap?'+new URLSearchParams(next),{headers:{Authorization:'Bearer '+token}});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'数据读取失败');
      if(request!==state.request)return;
      if(data.env!=='live')throw new Error('接口未返回真实数据');
      state.data=data;selection={taskId:data.task.id,date:data.task.selectedDate,group:data.task.selectedGroup,dimension:data.task.dimension};
      history.replaceState(null,'','?'+new URLSearchParams(selection));
      try { sessionStorage.setItem('deliverySelection',JSON.stringify(selection)); } catch { /* 存储受限时仍允许正常筛选。 */ }
      $('exportReport').disabled=false;renderData();
    } catch(error) {
      if(request!==state.request)return;
      $('dataSurface').innerHTML=`<div class="workspace-panel live-empty" role="alert">${esc(error.message)}<p>不会使用模拟数据替代。点击“刷新数据”重试。</p></div>`;
      $('contextStatus').textContent='数据暂不可用';$('syncStatus').textContent='未加载';
    }
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.dataset.task){selection={taskId:b.dataset.task};state.view='daily';load(selection);}
    if(b.dataset.date)load({...selection,date:b.dataset.date});
    if(b.dataset.phase){state.phase=b.dataset.phase;document.querySelectorAll('[data-phase]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b));});$('pageTitle').textContent=state.phase==='pre'?'人群画像':'投放中/后 · 效果优化';renderData();}
    for(const key of ['view','chart','period'])if(b.dataset[key]){state[key]=b.dataset[key];renderData();}
  });
  $('refreshAnalysis').onclick=()=>load();
  $('exportReport').onclick=()=>{
    if(!state.data)return;
    const blob=new Blob([JSON.stringify(state.data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`投放分析-${state.data.task.id}-${state.data.task.selectedDate}.json`;a.click();URL.revokeObjectURL(url);
  };
  $('aiForm').onsubmit=async e=>{e.preventDefault();const question=$('unifiedAiInput').value.trim();if(question && state.data){await window.askAi(question);$('unifiedAiInput').value='';}};
  load();
})();

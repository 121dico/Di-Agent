(function(){
  'use strict';
  window.deliveryActions=true;
  const $=id=>document.getElementById(id),all=s=>Array.from(document.querySelectorAll(s));
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const offline=window.deliveryOffline,live=window.deliveryLive;
  const savingTasks=new Set();
  const dailyModules=['movementOverview','dailyMetrics','dailyFunnelPanel','movementTrend','dailyBreakdownPanel','dailyInvalidPanel'];
  let catalog=[],sources=[],metricOptions={},moduleOptions=[],refreshing=false,exporting=false,initialized=false,restored=false,checkedRefresh=false;
  const data=()=>window.state.data;
  async function request(path,body,method=body?'POST':'GET',raw=false){
    const response=await fetch('/api/'+path,{method,headers:{Authorization:'Bearer '+(localStorage.getItem('di_agent_token')||''),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(raw?180000:30000)});
    if(!response.ok){const error=await response.json();throw new Error(error.error||error.message||'操作失败，请重试');}
    return raw?response:response.json();
  }
  function status(message){$('reportActionStatus').textContent=message;}
  function dialog(title,html){$('dialogTitle').textContent=title;$('dialogBody').innerHTML=html;$('infoDialog').showModal();}
  function feedback(message){$('reportFormFeedback').textContent=message;}
  function applyModules(){
    const current=data();if(!current)return;
    moduleOptions=current.moduleOptions||moduleOptions;
    let selected=current.analysisTask?.modules||moduleOptions.map(m=>m.id);
    if(current.analysisTask?.moduleVersion!==2&&selected.includes('subview-movement'))selected=[...new Set([...selected,...dailyModules])];
    for(const item of moduleOptions){$(item.id)?.classList.toggle('report-module-hidden',!selected.includes(item.id));all('[data-toc-target="'+item.id+'"]').forEach(n=>n.hidden=!selected.includes(item.id));}
    for(const phase of ['pre','monitor']){
      const section=$('phase-'+phase);let hint=section.querySelector('.report-empty-phase');
      if(!hint){hint=document.createElement('p');hint.className='report-empty-phase';section.appendChild(hint);}
      hint.textContent='本阶段没有已启用的模块，可在“配置分析模块”中调整。';hint.hidden=moduleOptions.some(m=>m.phase===phase&&selected.includes(m.id));
    }
    const daily=selected.includes('subview-movement')||dailyModules.some(id=>selected.includes(id));
    $('subview-movement').classList.toggle('report-module-hidden',!daily);all('[data-effect-view="daily"]').forEach(n=>n.hidden=!daily);
    const cumulative=moduleOptions.some(m=>m.phase==='monitor'&&![...dailyModules,'subview-movement','effectHistoryComparison'].includes(m.id)&&selected.includes(m.id));
    all('[data-effect-view="cumulative"]').forEach(n=>n.hidden=!cumulative);
    $('effectSettings').classList.toggle('report-module-hidden',!cumulative);
    $('subview-effect').classList.toggle('report-module-hidden',!daily&&!cumulative);
    $('effectHistoryComparison').classList.toggle('hidden',!selected.includes('effectHistoryComparison'));
    if(daily&&!cumulative)document.querySelector('[data-effect-view="daily"]')?.click();
    else if(!daily&&cumulative)document.querySelector('[data-effect-view="cumulative"]')?.click();
    if(current.analysisTask){
      $('contextTaskName').textContent=catalog.find(t=>t.id===current.analysisTask.parentId)?.name||current.analysisTask.name;
      all('.task-node,.task-group,.audience-option').forEach(n=>{if(current.analysisTask.id!==current.analysisTask.sourceId)n.classList.remove('active');});
      all('[data-analysis-task]').forEach(n=>n.classList.toggle('active',n.dataset.analysisTask===current.analysisTask.id));
      if(current.analysisTask.parentId){const parent=catalog.find(t=>t.id===current.analysisTask.parentId);const group=document.querySelector('[data-task-group="'+({coupon:'recall',effect:'summer'}[parent?.sourceId]||'')+'"]');if(group)group.classList.add('active');}
    }
  }
  async function loadCatalog(){
    const result=await request('tasks');catalog=result.items;sources=result.sources;moduleOptions=result.modules;metricOptions=result.metrics||{};
    all('.report-custom-task').forEach(n=>n.remove());
    for(const task of catalog.filter(t=>!t.builtin&&!t.parentId)){
      const button=document.createElement('button');button.type='button';button.className='task-node report-custom-task';button.dataset.analysisTask=task.id;
      const label=document.createElement('span');label.textContent=task.name;const hint=document.createElement('small');hint.textContent=task.purpose+' · 分析任务';label.appendChild(hint);button.appendChild(label);$('taskTree').appendChild(button);
    }
    renderAudienceTree();applyModules();
  }
  function configure(){
    const current=data();if(!current){status('请先选择并加载任务');return;}
    const id=current.analysisTask?.id||current.task.id;let chosen=current.analysisTask?.modules||moduleOptions.map(m=>m.id);if(current.analysisTask?.moduleVersion!==2&&chosen.includes('subview-movement'))chosen=[...new Set([...chosen,...dailyModules])];
    dialog('配置分析模块','<p>选择当前任务中显示的模块，线上配置会保存到账号；导出报告沿用此配置。</p><form id="moduleForm">'+['pre','monitor'].map(phase=>'<fieldset class="module-config-group"><legend>'+({pre:'投放前 · 人群洞察',monitor:'投放中/后 · 效果优化'}[phase])+'</legend>'+moduleOptions.filter(m=>m.phase===phase).map(m=>'<label><input type="checkbox" name="module" value="'+esc(m.id)+'" '+(chosen.includes(m.id)?'checked':'')+'>'+esc(m.label)+'</label>').join('')+'</fieldset>').join('')+'<p class="report-form-feedback" id="reportFormFeedback" role="status"></p><button class="primary-button full-button" id="saveReportModules" type="submit">保存模块配置</button></form>');
    const form=$('moduleForm'),activeForm=()=>$('infoDialog').open&&$('moduleForm')===form;
    form.onchange=event=>{
      const input=event.target;if(input.name!=='module')return;
      const parent=form.querySelector('[value="subview-movement"]');
      if(input===parent)dailyModules.forEach(id=>{const child=form.querySelector('[value="'+id+'"]');if(child)child.checked=parent.checked;});
      else if(dailyModules.includes(input.value)&&parent)parent.checked=dailyModules.some(id=>form.querySelector('[value="'+id+'"]')?.checked);
    };
    form.onsubmit=async event=>{
      event.preventDefault();const modules=all('#moduleForm input:checked').map(n=>n.value);
      if(!modules.length){feedback('至少保留一个分析模块');return;}
      if(savingTasks.has(id)){feedback('此任务的上一份配置正在保存，请完成后再保存');return;}
      savingTasks.add(id);
      const button=$('saveReportModules');button.disabled=true;
      try{
        const item=offline?{...current.analysisTask,modules,moduleVersion:2}:(await request('tasks/'+encodeURIComponent(id),{modules},'PATCH')).item;
        if(data()?.analysisTask?.id===id||(!data()?.analysisTask&&data()?.task.id===id)){data().analysisTask=item;applyModules();}
        if(offline)offline.analysisTask=item;
        if(activeForm())$('infoDialog').close();status(offline?'已调整此离线报告的显示模块':'模块配置已保存');
      }catch(e){if(activeForm())feedback(e.message);else status(e.message);}finally{savingTasks.delete(id);button.disabled=false;}
    };
  }
  async function createTask(){
    dialog('新建任务','<p>正在读取可选数据源…</p>');
    const placeholder=$('dialogBody').firstChild;
    const stillOpen=()=>$('infoDialog').open&&$('dialogBody').firstChild===placeholder;
    try{await loadCatalog();}catch(e){if(stillOpen())$('dialogBody').textContent=e.message;return;}
    if(!stillOpen())return;
    $('dialogBody').innerHTML='<form id="newAnalysisTaskForm" class="report-form"><p>为已接入的数据创建一个独立分析任务。任务名称和模块配置会保存，来源数据保持原有口径。</p><label for="newTaskName">任务名称<input id="newTaskName" maxlength="80" required placeholder="例如：九月召回效果复盘"></label><label for="newTaskPurpose">任务目的<select id="newTaskPurpose">'+['拉新','召回','促活','转化提升','用户关怀'].map(v=>'<option>'+v+'</option>').join('')+'</select></label><label for="newTaskSource">分析数据源<select id="newTaskSource" required><option value="">请选择已接入的数据源</option>'+sources.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+' · '+esc(t.partition||'已发布快照')+'</option>').join('')+'</select></label><p class="report-form-feedback" id="reportFormFeedback" role="status"></p><button id="confirmCreateTask" class="primary-button full-button" type="submit">创建并打开分析</button></form>';
    const selected=catalog.find(t=>t.id===live.selection().taskId);
    $('newTaskSource').value=selected?.sourceId||sources[0]?.id||'';
    $('newTaskPurpose').value=selected?.purpose||'召回';
    $('newTaskName').focus();
    const form=$('newAnalysisTaskForm'),activeForm=()=>$('infoDialog').open&&$('newAnalysisTaskForm')===form;
    form.onsubmit=async event=>{
      event.preventDefault();const button=$('confirmCreateTask');if(button.disabled)return;button.disabled=true;
      const previousSelection=JSON.stringify(live.selection());
      try{
        const result=await request('tasks',{name:$('newTaskName').value.trim(),purpose:$('newTaskPurpose').value,sourceId:$('newTaskSource').value});
        const shouldOpen=activeForm();if(shouldOpen)$('infoDialog').close();await loadCatalog();
        if(shouldOpen&&!$('infoDialog').open&&previousSelection===JSON.stringify(live.selection())){await live.load({taskId:result.item.id});document.querySelector('[data-analysis-task="'+result.item.id+'"]')?.focus();}
        status('已创建任务：'+result.item.name);
      }catch(e){if(activeForm())feedback(e.message);else status(e.message);}finally{button.disabled=false;}
    };
  }
  function renderAudienceTree(){
    if(offline)return;
    all('.managed-audience-tree').forEach(n=>n.remove());
    if(!offline)all('[data-task-group="recall"] .audience-branch > .audience-row').forEach(n=>n.hidden=true);
    for(const parent of catalog.filter(t=>!t.parentId)){
      const anchor=parent.builtin?document.querySelector('[data-task-group="'+({coupon:'recall',effect:'summer'}[parent.id]||'')+'"] .audience-branch'):document.querySelector('[data-analysis-task="'+parent.id+'"]');
      const container=document.createElement('div');container.className='managed-audience-tree';
      container.innerHTML=catalog.filter(t=>t.parentId===parent.id).map(t=>'<div class="audience-row"><button class="analysis-child audience-option-managed" type="button" data-analysis-task="'+esc(t.id)+'"><span>'+esc(t.name)+'</span><small>人群包 '+esc(t.crowdId)+'</small></button><div class="audience-actions"><button type="button" data-manage-edit="'+esc(t.id)+'" aria-label="修改'+esc(t.name)+'">修改</button><button type="button" data-manage-delete="'+esc(t.id)+'" aria-label="删除'+esc(t.name)+'">删除</button></div></div>').join('');
      if(!parent.builtin)container.insertAdjacentHTML('beforeend','<button class="link-button" type="button" data-manage-add="'+esc(parent.id)+'">＋ 新增人群分析</button>');
      if(anchor)parent.builtin?anchor.appendChild(container):anchor.after(container);
    }
    all('[data-add-audience-task]').forEach(n=>{n.disabled=!!offline||n.dataset.addAudienceTask==='activation';delete n.dataset.unavailable;n.title=n.disabled?'尚未接入该任务':'新增人群分析';});
    all('.managed-audience-tree .audience-actions button').forEach(n=>{n.disabled=false;delete n.dataset.unavailable;});
  }
  function groupFields(group={}){
    return '<div class="analysis-group-row"><label>组名<input name="groupName" maxlength="50" value="'+esc(group.name||'')+'" required></label><label>分组人群包 ID<input name="groupCrowd" inputmode="numeric" pattern="[0-9]{1,30}" value="'+esc(group.crowdId||'')+'" required></label><button type="button" class="link-button" data-remove-analysis-group>移除</button></div>';
  }
  async function editAnalysis(parentId,item=null,preset=null){
    if(offline)return;
    const parent=catalog.find(t=>t.id===parentId);if(!parent){status('任务目录尚未就绪，请稍后重试');return;}
    const isRoot=item&&!item.parentId&&!preset,kind=sources.find(t=>t.id===parent.sourceId)?.kind||data()?.task.kind||'coupon';
    const options=metricOptions[kind]||[{id:kind==='coupon'?'coupon_repurchase_rate':'order_penetration_rate',label:kind==='coupon'?'发券后 7 日复购率':'近 30 天订单渗透率'}];
    const effect=item?.effect||{},experiment=item?.experiment||{},crowd=preset?.id||item?.crowdId||'';
    const observed=kind==='coupon'?[['users','进组人数'],['coupon','领券人数'],['repurchase','复购人数']]:[['users','覆盖人数'],['achieved','个人达标人数']];
    dialog(isRoot?'配置效果与实验':item?'修改人群分析':'新增人群分析',
      '<form id="audienceAnalysisForm" class="report-form"><label>分析名称<input id="analysisName" maxlength="80" required value="'+esc(item?.name||preset?.prdLabel||'')+'"></label>'+(!isRoot?'<label>搜索新人群包（名称或 ID）<input id="analysisCrowdSearch" placeholder="输入名称或人群包 ID"></label><div id="analysisCrowdResults" role="status">已核验关联包目录；可录入其他包 ID 保存待核验关联。</div>':'')+
      '<label>'+ (isRoot?'整体人群包 ID（分组实验必填）':'整体人群包 ID')+'<input id="analysisCrowdId" inputmode="numeric" pattern="[0-9]{1,30}" '+(!isRoot?'required':'')+' value="'+esc(crowd||experiment.overallCrowdId||'')+'"></label><p id="analysisCrowdLink"></p><label>目标效果指标<select id="analysisMetric">'+options.map(m=>'<option value="'+esc(m.id)+'" '+(effect.metric===m.id?'selected':'')+'>'+esc(m.label)+'</option>').join('')+'</select></label><fieldset class="module-config-group"><legend>其他观测指标</legend>'+observed.map(([id,label])=>'<label><input type="checkbox" name="observedMetric" value="'+id+'" '+((effect.observedMetrics||['users']).includes(id)?'checked':'')+'>'+label+'</label>').join('')+'</fieldset><label>活动效果目标（%，未知可留空）<input type="number" id="analysisTarget" min="0" max="100" step="any" value="'+(Number.isFinite(effect.targetRate)?effect.targetRate*100:'')+'"></label><label>投放起始日期<input type="date" id="analysisStart" required value="'+esc(effect.startDate||data()?.task.cumulative?.startDate||'')+'"></label><label class="analysis-check"><input type="checkbox" id="analysisExperiment" '+(experiment.enabled?'checked':'')+'>设为分组实验</label><fieldset id="analysisGroups"><legend>全部分组人群包（至少两个）</legend><div id="analysisGroupRows">'+(experiment.groups?.length?experiment.groups:[{name:'对照组'},{name:'实验组'}]).map(groupFields).join('')+'</div><button type="button" class="link-button" id="addAnalysisGroup">＋ 添加分组</button></fieldset><label>AB Master 实验链接（可选）<input type="url" id="analysisExperimentURL" value="'+esc(experiment.url||'')+'" placeholder="https://x.intra.xiaojukeji.com/exp/…"></label><p>配置仅建立分析关联。人数与效果取已核验的数据；成员映射、历史快照未接入时显示缺数。</p><p id="reportFormFeedback" class="report-form-feedback" role="status"></p><button type="submit" class="primary-button full-button" id="saveAudienceAnalysis">保存'+(isRoot?'配置':'人群分析')+'</button></form>');
    const form=$('audienceAnalysisForm'),active=()=>$('infoDialog').open&&$('audienceAnalysisForm')===form;
    const syncExperiment=()=>{const enabled=$('analysisExperiment').checked;$('analysisGroups').hidden=!enabled;$('analysisGroups').disabled=!enabled;$('analysisCrowdId').required=!isRoot||enabled;};syncExperiment();$('analysisExperiment').onchange=syncExperiment;
    const syncLink=()=>{const id=$('analysisCrowdId').value.trim();$('analysisCrowdLink').innerHTML=/^\d{1,30}$/.test(id)?'<a target="_blank" rel="noopener noreferrer" href="https://ditag.intra.xiaojukeji.com/new-system/#/application/crowdDetail?id='+id+'&crowdUserType=normal&view=filter">打开新系统人群包 '+id+'</a>':'';};syncLink();$('analysisCrowdId').oninput=syncLink;
    $('addAnalysisGroup').onclick=()=>{if(form.querySelectorAll('.analysis-group-row').length>=20){feedback('最多 20 个分组');return;}$('analysisGroupRows').insertAdjacentHTML('beforeend',groupFields());};
    form.addEventListener('click',e=>{const remove=e.target.closest('[data-remove-analysis-group]');if(remove)remove.closest('.analysis-group-row').remove();const choice=e.target.closest('[data-choose-crowd]');if(choice){$('analysisCrowdId').value=choice.dataset.chooseCrowd;syncLink();}});
    let searchEpoch=0;
    const search=async()=>{const epoch=++searchEpoch;const query=$('analysisCrowdSearch').value;try{const result=await request('crowds?q='+encodeURIComponent(query));if(!active()||epoch!==searchEpoch)return;$('analysisCrowdResults').innerHTML='<p>'+esc(result.note)+'</p>'+result.items.map(c=>'<button type="button" class="secondary-button compact-button" data-choose-crowd="'+esc(c.id)+'">'+esc(c.name)+' · '+esc(c.id)+'</button>').join('')+(result.items.length?'':'<p>已核验目录中无匹配项，可在下方录入包 ID；保存后仍需核验成员映射。</p>');}catch(e){if(active()&&epoch===searchEpoch)$('analysisCrowdResults').textContent=e.message;}};
    if(!isRoot){$('analysisCrowdSearch').oninput=search;void search();}
    form.onsubmit=async e=>{
      e.preventDefault();const button=$('saveAudienceAnalysis');if(button.disabled)return;
      const lock=item?.id||parentId;if(savingTasks.has(lock)){feedback('上一份配置正在保存，请稍后再试');return;}savingTasks.add(lock);button.disabled=true;
      const target=$('analysisTarget').value;
      const body={name:$('analysisName').value,crowdId:$('analysisCrowdId').value.trim(),effect:{metric:$('analysisMetric').value,observedMetrics:Array.from(form.querySelectorAll('[name="observedMetric"]:checked')).map(n=>n.value),targetRate:target===''?null:Number(target)/100,startDate:$('analysisStart').value},experiment:{enabled:$('analysisExperiment').checked,groups:Array.from(form.querySelectorAll('.analysis-group-row')).map(n=>({name:n.querySelector('[name="groupName"]').value,crowdId:n.querySelector('[name="groupCrowd"]').value.trim()})),url:$('analysisExperimentURL').value.trim()}};
      const before=JSON.stringify(live.selection());
      try{const result=await request('tasks/'+encodeURIComponent(item?.id||parentId)+(item?'':'/audiences'),body,item?'PATCH':'POST');const shouldOpen=active();if(shouldOpen)$('infoDialog').close();await loadCatalog();if(shouldOpen&&!$('infoDialog').open&&before===JSON.stringify(live.selection()))await live.load({taskId:result.item.id});status('已保存：'+result.item.name);}catch(error){if(active())feedback(error.message);else status(error.message);}finally{savingTasks.delete(lock);button.disabled=false;}
    };
  }
  function deleteAnalysis(id){
    const item=catalog.find(t=>t.id===id);if(!item?.parentId)return;
    dialog('删除人群分析','<p>删除“'+esc(item.name)+'”的分析配置，源人群包及源数据保留。</p><p id="reportFormFeedback" role="status"></p><button type="button" class="primary-button" id="confirmDeleteAnalysis">删除此分析</button>');
    const button=$('confirmDeleteAnalysis');button.onclick=async()=>{
      if(savingTasks.has(id)){feedback('配置正在保存，请稍后重试');return;}savingTasks.add(id);button.disabled=true;const before=JSON.stringify(live.selection());
      try{await request('tasks/'+encodeURIComponent(id),undefined,'DELETE');if($('confirmDeleteAnalysis')===button)$('infoDialog').close();await loadCatalog();if(live.selection().taskId===id&&before===JSON.stringify(live.selection()))await live.load({taskId:item.parentId});status('已删除分析，源人群包保留');}catch(e){if($('confirmDeleteAnalysis')===button)feedback(e.message);else status(e.message);}finally{savingTasks.delete(id);button.disabled=false;}
    };
  }
  async function refresh(resume=false){
    if(refreshing)return;refreshing=true;$('refreshAnalysis').disabled=true;const label=$('refreshAnalysis').lastChild;label.textContent='分析中…';$('refreshAnalysis').setAttribute('aria-busy','true');
    try{
      status('正在后台重新分析，当前已发布快照仍可查看…');if(!resume)await request('refresh',{});
      const started=Date.now();let result;
      do{await new Promise(r=>setTimeout(r,2000));result=await request('refresh');if(Date.now()-started>30*60*1000)throw new Error('分析仍在后台运行，可稍后再次查看结果');}while(result.status.refreshing);
      if(result.status.lastError)throw new Error(result.status.lastError);
      // 保留用户操作期间切换后的范围，不让旧任务覆盖当前页面。
      await live.load(live.selection());status('重新分析完成 · 快照 '+new Date(result.builtAt).toLocaleString('zh-CN'));
    }catch(e){status(e.message+'；当前已发布结果保留，可再次点击重新分析。');}
    finally{refreshing=false;$('refreshAnalysis').disabled=false;label.textContent='重新分析';$('refreshAnalysis').removeAttribute('aria-busy');}
  }
  async function download(dailyReport=false){
    if(exporting||!data())return;exporting=true;$('exportReport').disabled=true;$('exportDailyReport').disabled=true;
    const current=data(),selection=live.selection(),view=live.view();
    if(dailyReport){view.phase='monitor';view.effect='daily';}
    try{
      status('正在生成离线交互 HTML…');
      const response=await request('export',{selection,view,builtAt:current.builtAt},'POST',true);
      const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=(dailyReport?'投放日报-'+current.task.selectedDate+'-':'投放分析-')+(current.analysisTask?.name||current.task.name||current.task.id).replace(/[\\/:*?"<>|]/g,'-')+'.html';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      status(dailyReport?'日报已生成，保留当前日期、指标和周期，可离线打开核验。':'HTML 已导出，可直接打开并离线交互。');
    }catch(e){status(e.message);}finally{exporting=false;$('exportReport').disabled=!data();$('exportDailyReport').disabled=!data();}
  }
  function init(){
    if(initialized)return;initialized=true;
    $('dailyInvalidTitle').closest('.daily-invalid-panel').id='dailyInvalidPanel';
    const configButton=document.createElement('button');configButton.type='button';configButton.id='configureAnalysisEffect';configButton.className='secondary-button compact-button';configButton.textContent='效果与实验配置';$('configureReportModules').before(configButton);
    window.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||button.disabled||offline)return;
      let handled=true;
      const selected=data()?.analysisTask;
      if(button.id==='configureAnalysisEffect'&&selected)editAnalysis(selected.parentId||selected.id,selected);
      else if(button.dataset.manageAdd)editAnalysis(button.dataset.manageAdd);
      else if(button.dataset.manageEdit){const item=catalog.find(t=>t.id===button.dataset.manageEdit);if(item)editAnalysis(item.parentId,item);}
      else if(button.dataset.manageDelete)deleteAnalysis(button.dataset.manageDelete);
      else if(button.hasAttribute('data-add-audience-task')){const key=button.dataset.addAudienceTask||button.closest('[data-task-group]')?.dataset.taskGroup;editAnalysis(({recall:'coupon',summer:'effect'}[key])||selected?.parentId||selected?.id);}
      else if(button.matches('[data-task-group="recall"] [data-edit-audience],[data-task-group="recall"] [data-delete-audience]')){
        const original=button.closest('.audience-row').querySelector('[data-live-select-crowd]');const crowd=data()?.task.crowdReferences?.find(c=>c.id===original?.dataset.liveSelectCrowd);
        if(crowd){const item=catalog.find(t=>t.parentId==='coupon'&&t.crowdId===crowd.id);if(button.dataset.deleteAudience){if(item)deleteAnalysis(item.id);else status('这是 PRD 关联包入口，尚未创建可删除的分析配置。');}else editAnalysis('coupon',item||null,crowd);}
      }else handled=false;
      if(handled){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    const message=document.createElement('div');message.id='reportActionStatus';message.className='report-action-status';message.setAttribute('role','status');$('stageTabs').before(message);
    document.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      const handlers={configureReportModules:configure,createTask,refreshAnalysis:refresh,exportReport:download,exportDailyReport:()=>download(true)};
      if(handlers[button.id]){event.stopImmediatePropagation();if(!button.disabled)handlers[button.id]();}
      if(button.dataset.analysisTask){event.stopImmediatePropagation();live.load({taskId:button.dataset.analysisTask});}
    },true);
    const update=()=>{
      renderAudienceTree();applyModules();
      const current=data(),config=current?.analysisTask?.effect;
      let details=$('analysisConfigurationSummary');if(!details){details=document.createElement('div');details.id='analysisConfigurationSummary';details.className='report-config-summary';$('stageTabs').after(details);}
      details.hidden=!config;
      if(config){const labels={coupon_repurchase_rate:'发券后 7 日复购率',order_penetration_rate:'近 30 天订单渗透率',achievement_rate:'累计个人达标率'};details.textContent='当前分析配置 · '+labels[config.metric]+' · 目标 '+(Number.isFinite(config.targetRate)?(config.targetRate*100).toFixed(2)+'%':'未设置')+' · 投放起始 '+config.startDate+' · 观测 '+config.observedMetrics.map(id=>({users:'人数',coupon:'领券',repurchase:'复购',achieved:'达标'}[id])).join('、');
        const experiment=current.analysisTask.experiment;if(experiment?.url){const link=document.createElement('a');link.href=experiment.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=' 查看 AB Master 实验';details.appendChild(link);}}

      if(!offline&&data()&&!checkedRefresh){checkedRefresh=true;if(data().status?.refreshing)void refresh(true);}
      if(offline&&data()&&!restored){restored=true;live.restoreView(offline.view);document.querySelector('[data-phase="'+(offline.view.phase==='monitor'?'monitor':'pre')+'"]')?.click();document.querySelector('[data-effect-view="'+(offline.view.effect==='daily'?'daily':'cumulative')+'"]')?.click();applyModules();}
    };
    window.addEventListener('delivery:data',update);
    if(offline){
      document.body.classList.add('report-offline');
      for(const id of ['refreshAnalysis','exportReport','exportDailyReport','createTask','changeTask','openHelp','configureAnalysisEffect']){const n=$(id);if(n){n.hidden=true;n.disabled=true;}};
      // 保留原按钮数据绑定所需节点，但彻底关闭在线交互和账户入口。
      all('form[action],iframe').forEach(n=>n.remove());
      status('离线交互报告 · 数据快照 '+new Date(offline.snapshot.builtAt).toLocaleString('zh-CN')+' · 筛选仅使用文件内聚合数据');
    }else loadCatalog().catch(e=>status('任务目录加载失败：'+e.message));
    update();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

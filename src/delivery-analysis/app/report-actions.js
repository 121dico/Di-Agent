(function(){
  'use strict';
  window.deliveryActions=true;
  const $=id=>document.getElementById(id),all=s=>Array.from(document.querySelectorAll(s));
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const offline=window.deliveryOffline,live=window.deliveryLive;
  const savingTasks=new Set();
  let catalog=[],sources=[],moduleOptions=[],refreshing=false,exporting=false,initialized=false,restored=false,checkedRefresh=false;
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
    const selected=current.analysisTask?.modules||moduleOptions.map(m=>m.id);
    for(const item of moduleOptions){$(item.id)?.classList.toggle('report-module-hidden',!selected.includes(item.id));all('[data-toc-target="'+item.id+'"]').forEach(n=>n.hidden=!selected.includes(item.id));}
    for(const phase of ['pre','monitor']){
      const section=$('phase-'+phase);let hint=section.querySelector('.report-empty-phase');
      if(!hint){hint=document.createElement('p');hint.className='report-empty-phase';section.appendChild(hint);}
      hint.textContent='本阶段没有已启用的模块，可在“配置分析模块”中调整。';hint.hidden=moduleOptions.some(m=>m.phase===phase&&selected.includes(m.id));
    }
    const daily=selected.includes('subview-movement');all('[data-effect-view="daily"]').forEach(n=>n.hidden=!daily);
    const cumulative=moduleOptions.some(m=>m.phase==='monitor'&&!['subview-movement','effectHistoryComparison'].includes(m.id)&&selected.includes(m.id));
    all('[data-effect-view="cumulative"]').forEach(n=>n.hidden=!cumulative);
    $('effectSettings').classList.toggle('report-module-hidden',!cumulative);
    $('subview-effect').classList.toggle('report-module-hidden',!daily&&!cumulative);
    $('effectHistoryComparison').classList.toggle('hidden',!selected.includes('effectHistoryComparison'));
    if(daily&&!cumulative)document.querySelector('[data-effect-view="daily"]')?.click();
    else if(!daily&&cumulative)document.querySelector('[data-effect-view="cumulative"]')?.click();
    if(current.analysisTask){
      $('contextTaskName').textContent=current.analysisTask.name;
      all('.task-node,.task-group,.audience-option').forEach(n=>{if(current.analysisTask.id!==current.analysisTask.sourceId)n.classList.remove('active');});
      all('[data-analysis-task]').forEach(n=>n.classList.toggle('active',n.dataset.analysisTask===current.analysisTask.id));
    }
  }
  async function loadCatalog(){
    const result=await request('tasks');catalog=result.items;sources=result.sources;moduleOptions=result.modules;
    all('.report-custom-task').forEach(n=>n.remove());
    for(const task of catalog.filter(t=>!t.builtin)){
      const button=document.createElement('button');button.type='button';button.className='task-node report-custom-task';button.dataset.analysisTask=task.id;
      const label=document.createElement('span');label.textContent=task.name;const hint=document.createElement('small');hint.textContent=task.purpose+' · 分析任务';label.appendChild(hint);button.appendChild(label);$('taskTree').appendChild(button);
    }
    applyModules();
  }
  function configure(){
    const current=data();if(!current){status('请先选择并加载任务');return;}
    const id=current.analysisTask?.id||current.task.id,chosen=current.analysisTask?.modules||moduleOptions.map(m=>m.id);
    dialog('配置分析模块','<p>选择当前任务中显示的模块，线上配置会保存到账号；导出报告沿用此配置。</p><form id="moduleForm">'+['pre','monitor'].map(phase=>'<fieldset class="module-config-group"><legend>'+({pre:'投放前 · 人群洞察',monitor:'投放中/后 · 效果优化'}[phase])+'</legend>'+moduleOptions.filter(m=>m.phase===phase).map(m=>'<label><input type="checkbox" name="module" value="'+esc(m.id)+'" '+(chosen.includes(m.id)?'checked':'')+'>'+esc(m.label)+'</label>').join('')+'</fieldset>').join('')+'<p class="report-form-feedback" id="reportFormFeedback" role="status"></p><button class="primary-button full-button" id="saveReportModules" type="submit">保存模块配置</button></form>');
    const form=$('moduleForm'),activeForm=()=>$('infoDialog').open&&$('moduleForm')===form;
    form.onsubmit=async event=>{
      event.preventDefault();const modules=all('#moduleForm input:checked').map(n=>n.value);
      if(!modules.length){feedback('至少保留一个分析模块');return;}
      if(savingTasks.has(id)){feedback('此任务的上一份配置正在保存，请完成后再保存');return;}
      savingTasks.add(id);
      const button=$('saveReportModules');button.disabled=true;
      try{
        const item=offline?{...current.analysisTask,modules}:(await request('tasks/'+encodeURIComponent(id),{modules},'PATCH')).item;
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
    const message=document.createElement('div');message.id='reportActionStatus';message.className='report-action-status';message.setAttribute('role','status');$('stageTabs').before(message);
    document.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      const handlers={configureReportModules:configure,createTask,refreshAnalysis:refresh,exportReport:download,exportDailyReport:()=>download(true)};
      if(handlers[button.id]){event.stopImmediatePropagation();if(!button.disabled)handlers[button.id]();}
      if(button.dataset.analysisTask){event.stopImmediatePropagation();live.load({taskId:button.dataset.analysisTask});}
    },true);
    const update=()=>{
      applyModules();
      if(!offline&&data()&&!checkedRefresh){checkedRefresh=true;if(data().status?.refreshing)void refresh(true);}
      if(offline&&data()&&!restored){restored=true;live.restoreView(offline.view);document.querySelector('[data-phase="'+(offline.view.phase==='monitor'?'monitor':'pre')+'"]')?.click();document.querySelector('[data-effect-view="'+(offline.view.effect==='daily'?'daily':'cumulative')+'"]')?.click();applyModules();}
    };
    window.addEventListener('delivery:data',update);
    if(offline){
      document.body.classList.add('report-offline');
      for(const id of ['refreshAnalysis','exportReport','exportDailyReport','createTask','changeTask','openHelp']){const n=$(id);if(n){n.hidden=true;n.disabled=true;}};
      // 保留原按钮数据绑定所需节点，但彻底关闭在线交互和账户入口。
      all('form[action],iframe').forEach(n=>n.remove());
      status('离线交互报告 · 数据快照 '+new Date(offline.snapshot.builtAt).toLocaleString('zh-CN')+' · 筛选仅使用文件内聚合数据');
    }else loadCatalog().catch(e=>status('任务目录加载失败：'+e.message));
    update();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

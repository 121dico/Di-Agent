(function () {
  'use strict';
  const service = window.deliveryAgent;
  if (!service) return;
  const make = (tag, className = '', text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = () => {
    const span = make('span','delivery-agent-icon');
    // 固定图标，不插入用户或模型 HTML。
    span.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2m16 0h2M9 13v2m6-2v2"/></svg>';
    return span;
  };
  const dock = make('div','delivery-agent-dock');
  const launcher = make('button','delivery-agent-launcher');
  launcher.type = 'button'; launcher.setAttribute('aria-label','打开投放agent'); launcher.setAttribute('aria-expanded','false');
  launcher.title = '投放agent · 拖动调整位置'; launcher.append(icon()); dock.append(launcher);
  const panel = make('section','delivery-agent-panel');
  panel.id = 'delivery-agent-panel'; panel.hidden = true; panel.setAttribute('role','dialog'); panel.setAttribute('aria-label','投放agent对话'); panel.setAttribute('aria-modal','false');
  launcher.setAttribute('aria-controls',panel.id);
  const header = make('header','delivery-agent-header');
  const heading = make('div','delivery-agent-heading');
  const status = make('span','','陪你看清每一次投放'); heading.append(make('strong','','投放agent'),status);
  const close = make('button','delivery-agent-close','−'); close.type = 'button'; close.setAttribute('aria-label','收起投放agent');
  header.append(icon(),heading,close);
  const picker = make('label','delivery-agent-picker','执行 Agent');
  const agentSelect = make('select'); agentSelect.setAttribute('aria-label','投放执行 Agent'); picker.append(agentSelect);
  agentSelect.addEventListener('change',()=>{void service.selectAgent(agentSelect.value).catch(failure=>{showError(failure.message);render(service.snapshot());});});
  const context = make('div','delivery-agent-context');
  const contextName = make('strong'); const contextScope = make('span'); context.append(make('small','','当前投放'),contextName,contextScope);
  const list = make('div','delivery-agent-messages'); list.setAttribute('role','log'); list.setAttribute('aria-label','投放问答记录');
  const notice = make('div','delivery-agent-notice'); notice.hidden = true; notice.setAttribute('role','alert');
  const noticeText = make('span'); const retry = make('button','','重新连接'); retry.type = 'button'; notice.append(noticeText,retry);
  const form = make('form','delivery-agent-composer');
  const input = make('textarea','delivery-agent-input'); input.rows = 2; input.maxLength = 12000; input.placeholder = '问问投放agent…'; input.setAttribute('aria-label','向投放agent提问');
  const bottom = make('div','delivery-agent-composer-bottom'); const hint = make('small','','Enter 发送 · Shift + Enter 换行');
  const send = make('button','delivery-agent-send','↑'); send.type = 'submit'; send.setAttribute('aria-label','发送给投放agent');
  bottom.append(hint,send); form.append(input,bottom); panel.append(header,picker,context,list,notice,form); document.body.append(dock,panel);
  let agentSignature = '';
  let open = false, composing = false, moved = false, drag = null, position = null, signature = '', lastIdentity = '';
  let model = service.snapshot();
  const userKey = () => window.state?.data?.currentUser?.id || 'anonymous';
  const storageKey = () => 'di_agent:delivery-agent-position:' + userKey();
  function place(next) {
    const margin = 12, width = window.innerWidth, height = window.innerHeight;
    position = {x:Math.max(margin,Math.min(next.x,width-76)), y:Math.max(margin,Math.min(next.y,height-64))};
    dock.style.setProperty('--delivery-agent-x',position.x+'px'); dock.style.setProperty('--delivery-agent-y',position.y+'px');
    const panelWidth = Math.min(420,width-24), panelHeight = Math.min(580,height-100);
    panel.style.setProperty('--delivery-agent-x',Math.max(margin,Math.min(position.x+64-panelWidth,width-panelWidth-margin))+'px');
    panel.style.setProperty('--delivery-agent-y',Math.max(margin,Math.min(position.y-panelHeight-12,height-panelHeight-margin))+'px');
  }
  function restore() {
    let saved; try {saved=JSON.parse(localStorage.getItem(storageKey()));} catch {saved=null;}
    place(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : {x:window.innerWidth-88,y:window.innerHeight-108});
  }
  function updateContext() {
    const task = window.state?.data?.task;
    const identity = userKey();
    if (identity !== lastIdentity) {lastIdentity=identity;restore();}
    const name = task?.name || (task?.kind === 'coupon' ? '召回复购发券 · 实验分析' : task ? '安心充权益优惠投放' : '请选择已接入的任务');
    const group = task?.selectedGroup === 'all' ? '整体' : task?.selectedGroup || '';
    const scope = task ? [task.selectedDate,group,task.dimensionOptions?.[task.portraitDimension || task.dimension]].filter(Boolean).join(' · ') : '数据加载后即可提问';
    if (contextName.textContent !== name) contextName.textContent=name;
    if (contextScope.textContent !== scope) contextScope.textContent=scope;
    send.disabled = model.busy || model.connecting || !input.value.trim() || !task;
  }
  function setOpen(value) {
    open=value; panel.hidden=!open; launcher.setAttribute('aria-expanded',String(open)); launcher.setAttribute('aria-label',open?'收起投放agent':'打开投放agent');
    place(position);
    if (open) {updateContext();input.focus();void service.history().catch(failure => showError(failure.message));}
    else launcher.focus();
  }
  function showError(message) {notice.hidden=false;noticeText.textContent=message;}
  function inlineText(node, text) {
    // 仅处理强调与代码；模型返回的 HTML、链接或脚本全部保持为文本。
    for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
      if (part.startsWith('**') && part.endsWith('**')) node.append(make('strong','',part.slice(2,-2)));
      else if (part.startsWith('`') && part.endsWith('`')) node.append(make('code','',part.slice(1,-1)));
      else node.append(document.createTextNode(part));
    }
  }
  function answerText(text) {
    const content = make('div','delivery-agent-text');
    const lines = text.split('\n');
    const cells = line => line.trim().replace(/^\||\|$/g,'').split('|').map(cell => cell.trim());
    for (let index=0; index<lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) continue;
      if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index+1] || '')) {
        const wrap=make('div','delivery-agent-table'),table=make('table'),head=make('thead'),header=make('tr');
        for(const cell of cells(line)){const th=make('th');inlineText(th,cell);header.append(th);}
        head.append(header);table.append(head);index+=2;
        const body=make('tbody');
        while(index<lines.length && lines[index].includes('|')){
          const row=make('tr');for(const cell of cells(lines[index])){const td=make('td');inlineText(td,cell);row.append(td);}body.append(row);index++;
        }
        index--;table.append(body);wrap.append(table);content.append(wrap);continue;
      }
      const heading = /^#{1,4}\s+/.test(line);
      const paragraph=make(heading?'h4':'p');inlineText(paragraph,heading?line.replace(/^#{1,4}\s+/,''):line);content.append(paragraph);
    }
    return content;
  }
  function bubble(role,text,historySource) {
    const row = make('div','delivery-agent-message '+(role==='user'?'delivery-agent-user':'delivery-agent-assistant'));
    row.append(make('small','',(role==='user'?'你':'投放agent')+(historySource?' · 历史会话':'')),role==='user'?make('div','delivery-agent-text',text):answerText(text));return row;
  }
  function render(value) {
    model=value; updateContext();
    const nextAgents=JSON.stringify([value.agents,value.session?.agent.id]);
    if(nextAgents!==agentSignature){
      agentSignature=nextAgents;agentSelect.replaceChildren();
      for(const agent of value.agents || []){
        const runtime=agent.cli_tool==='codex'?'GPT / Codex':agent.cli_tool==='claude'?'Claude':agent.cli_tool;
        const online=['online','busy'].includes(agent.status);
        const option=make('option','',agent.name+' · '+runtime+' · '+(agent.machine_name||'本地')+(online?'':'（离线）'));
        option.value=agent.id;option.disabled=!online;agentSelect.append(option);
      }
      if(value.session)agentSelect.value=value.session.agent.id;
    }
    agentSelect.disabled=value.busy||value.connecting||!value.session;
    status.textContent=value.connecting?'正在连接':value.busy?'正在分析':value.session?'陪你看清每一次投放':'连接后即可继续对话';
    hint.textContent=value.busy?'正在分析，收起后仍会继续':'Enter 发送 · Shift + Enter 换行';
    notice.hidden=!value.error; noticeText.textContent=value.error; retry.disabled=value.busy||value.connecting;
    const nextSignature=JSON.stringify([value.items,value.currentQuestion,value.partial,value.busy]);
    if (signature===nextSignature)return; signature=nextSignature;
    const atBottom=list.scrollHeight-list.scrollTop-list.clientHeight<70;
    list.replaceChildren();
    if (!value.items.length && !value.currentQuestion) {
      const empty=make('div','delivery-agent-empty'); empty.append(icon(),make('strong','','一起看看这次投放'),make('p','','可以问我人群特征、指标口径，或当前任务的效果。'));
      for (const question of ['当前人群有哪些特征？','当前指标的分母和日期口径是什么？','实验组和对照组有哪些差异？']) {
        const suggestion=make('button','delivery-agent-suggestion',question);suggestion.type='button';suggestion.addEventListener('click',()=>{input.value=question;updateContext();input.focus();});empty.append(suggestion);
      }
      list.append(empty);
    }
    for (const item of value.items) list.append(bubble(item.role,item.text,item.historySource));
    if (value.currentQuestion) {
      list.append(bubble('user',value.currentQuestion));
      list.append(bubble('assistant',value.partial || (value.busy?'正在读取当前页面数据并分析…':'等待重新连接查看回复')));
    }
    if (atBottom || value.busy) list.scrollTop=list.scrollHeight;
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault(); const question=input.value.trim();if (!question || model.busy)return;
    try {await service.send(question);if (input.value.trim()===question)input.value='';}
    catch(failure){showError(failure.message);}
    updateContext();
  });
  input.addEventListener('input',updateContext);
  input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&!composing&&event.keyCode!==229){event.preventDefault();form.requestSubmit();}});
  close.addEventListener('click',()=>setOpen(false)); retry.addEventListener('click',()=>{void service.reconnect();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&open&&!event.defaultPrevented)setOpen(false);});
  window.addEventListener('delivery-agent-open',()=>{if(!open)setOpen(true);});
  launcher.addEventListener('click',()=>{if(moved){moved=false;return;}setOpen(!open);});
  launcher.addEventListener('pointerdown',event=>{if(event.button!==0)return;moved=false;drag={id:event.pointerId,x:event.clientX,y:event.clientY,origin:position};launcher.setPointerCapture(event.pointerId);});
  launcher.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!moved&&Math.hypot(dx,dy)<6)return;moved=true;place({x:drag.origin.x+dx,y:drag.origin.y+dy});
  });
  function finish(event) {
    if(!drag||drag.id!==event.pointerId)return;drag=null;
    if(launcher.hasPointerCapture(event.pointerId))launcher.releasePointerCapture(event.pointerId);
    if(moved){try{localStorage.setItem(storageKey(),JSON.stringify(position));}catch{/* 存储失败不影响本次使用。 */}}
  }
  for(const event of ['pointerup','pointercancel','lostpointercapture'])launcher.addEventListener(event,finish);
  window.addEventListener('resize',()=>{drag=null;place(position);});
  window.addEventListener('storage',event=>{if(event.key==='di_agent_token'){input.value='';signature='';restore();}});
  restore();service.subscribe(render);
  // 原工作台同时有异步加载与页签事件，只观察主内容，不观察浮窗以免自触发。
  const source=document.getElementById('phaseAvailabilityNote')?.parentElement;
  if(source)new MutationObserver(updateContext).observe(source,{childList:true,subtree:true,characterData:true});
})();

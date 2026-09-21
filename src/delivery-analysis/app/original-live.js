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
  let selection = window.deliveryOffline?.selection || {taskId:'effect'}, chart = window.deliveryOffline?.view.chart || 'pie', funnel = window.deliveryOffline?.view.funnel || 'funnel', resourceFunnel = window.deliveryOffline?.view.resourceFunnel || 'funnel', initialized = false;
  const dimensions = {lifecycle:'charge_life_cycle',orders:'charge_freq_type',frequency:'charge_freq_type',identity:'charge_duid_role_name_v2_type',membership:'member_status',member:'member_status',cityFrame:'city_fenkuang',warZone:'charge_region',city:'city_name'};
  const colors = ['#2563eb','#14b8a6','#f59e0b','#94a3b8','#c24136','#7c3aed'];
  const groupName = (group, kind) => kind === 'coupon' ? (group === 'treatment_group' ? '实验组' : '对照组') : '来源 ' + group + ' 组';
  function text(selector, value) { const node = one(selector); if (node) node.textContent = value; }
  function notice(message) { $('phaseAvailabilityNote').textContent = message; $('phaseAvailabilityNote').classList.remove('hidden'); }
  function metric(id, cards) {
    const container=$(id);if(!container)return;while(container.querySelectorAll('.metric-card').length<cards.length){const card=document.createElement('article');card.className='metric-card';card.innerHTML='<div class="metric-top"><span></span></div><strong></strong><small></small>';container.appendChild(card);}
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
    text('#audiencePackageMeta .package-heading strong', task ? (task.kind === 'coupon' ? '任务 '+task.sourceTaskId+' · 进组日 '+task.selectedDate : '近30天安心充低频购买用户') : '暂无数据');
    const values = task ? {'分析类型':'来源分组统计','分析实体':'DUID','快照日期':task.portraitPartition,'人群时效性':'来源日快照'} : {};
    const crowds=task?.crowdReferences||[];
    if(crowds.length)Object.assign(values,{'整体人群包 ID':'PRD关联：'+crowds.map(c=>c.id).join(' / '),'人群包状态':crowds.map(c=>c.status).every(v=>v===crowds[0].status)?'关联包均'+crowds[0].status:'见各包详情','有效期结束':crowds.every(c=>c.validUntil===crowds[0].validUntil)?crowds[0].validUntil:'见各包详情'});
    all('#audiencePackageMeta .package-meta-row').forEach(row => {
      row.querySelector('strong').textContent = values[row.querySelector(':scope > span').textContent] || '—';
    });
  }
  function deploymentDetails(ref,records=ref.records) {
    const rows=records.map(r=>[r.cycle+'天 / '+portraitGroupName(r.group,'coupon'),r.redPacketId,r.offlineAt]);
    return '<strong>BOSS 投放配置 · '+records.length+' 条</strong><p>'+esc(ref.captureMode+'；录入日期 '+ref.observedOn)+'</p><p>配置投放期：'+esc(ref.schedule.start+' → '+ref.schedule.end)+'；'+esc(ref.schedule.period+'，'+ref.schedule.hours)+'</p><p>自动发券 · 屏蔽新人 · 人群不反选 · '+ref.frequency.days+'天内最多投放'+ref.frequency.max+'次 · '+ref.cities.length+'个城市 / '+ref.channels.length+'个投放端</p><div class="deployment-table">'+table(['人群周期 / 组别','天降红包 ID','下线操作记录'],rows)+'</div><details><summary>查看完整配置、创建记录与投放范围</summary>'+records.map(r=>'<h4>'+esc(r.name)+'</h4>'+table(['字段','来源值'],[['人群包ID',r.crowdId],['实验接入 / 组别',ref.toggle+' / '+r.group],['红包名称',r.redPacketName],['红包ID',r.redPacketId],['资源记录ID','未提供'],['券批次ID','未提供'],['创建记录',r.createdAt+' · '+r.operator],['下线记录',r.offlineAt+' · '+r.operator]])).join('')+'<p>业务线：'+esc(ref.business)+'；团队：'+esc(ref.team)+'；资源位：'+esc(ref.placeholderName+'（'+ref.placeholderId+'）')+'；区块限制：'+esc(ref.blockRestriction)+'；提示文案：'+esc(ref.prompt)+'</p><p>投放端：'+esc(ref.channels.join('、'))+'</p><p>投放城市：'+esc(ref.cities.join('、'))+'</p><p><a href="'+esc(ref.proposalURL)+'" target="_blank" rel="noopener noreferrer">查看关联望岳提报</a></p></details><p>对照组红包名称为“单5折5元”，与Apollo“一张8折5元券”描述不同，实际券配置待核验。</p><details><summary>配置与效果数据的区别</summary>'+ref.notes.map(n=>'<p>'+esc(n)+'</p>').join('')+'</details>';
  }
  function renderDeploymentReference(task,mode) {
    const panel=$(mode==='daily'?'dailyFunnelPanel':'resourceFunnelPanel');
    let node=panel.querySelector('.boss-reference');if(!node){node=document.createElement('div');node.className='boss-reference';panel.appendChild(node);}
    const ref=task.deploymentReference;
    node.hidden=!ref || (mode==='daily'&&!selectedRows(task).some(r=>r.date===task.selectedDate));
    if(node.hidden){node.replaceChildren();return;}
    const group=mode==='daily'?task.selectedGroup:task.cumulative?.selectedGroup||'all';
    node.innerHTML=deploymentDetails(ref,ref.records.filter(r=>group==='all'||r.group===group));
  }
  function crowdDetails(crowd,deployments) {
    const rows=[['PRD关联',crowd.prdLabel],['Ditag当前名称',crowd.name],['人群包 ID',crowd.id],['当前人数',num(crowd.currentUsers)+' 人'],['人数更新时间',crowd.updatedAt],['人群状态 / 类型',crowd.status+' / '+crowd.type],['有效时间',crowd.validFrom+' → '+crowd.validUntil],['当前规则版本',crowd.version+' · '+crowd.versionAt],['平台实体 / 创建人', '页面未标注 / 尚未核验']];
    return '<p>'+esc(crowd.captureMode+'；采集日期 '+crowd.observedOn)+'。</p>'+table(['项目','来源记录'],rows)+'<h4>当前规则</h4><ul>'+crowd.rules.map(r=>'<li>'+esc(r)+'</li>').join('')+'</ul>'+(crowd.whitelistCount?'<p>页面另列白名单 '+num(crowd.whitelistCount)+' 个 ID（未读取个人ID）。</p>':'')+'<h4>投放前规则版本 '+esc(crowd.historical.version)+'</h4><p>'+esc(crowd.historical.name+' · '+crowd.historical.versionAt)+'</p><ul>'+crowd.historical.rules.map(r=>'<li>'+esc(r)+'</li>').join('')+'</ul><p>历史版本的具体筛选条件、人数和分组画像尚未单独核验；不沿用当前规则和人数回填历史。</p><p>'+esc(crowd.note)+'</p><p>包资料仅供核对，统计范围以上方所选分析为准；包成员未关联时不回填任务全量。</p><a target="_blank" rel="noopener noreferrer" href="'+esc(crowd.sourceURL)+'">打开 Ditag 原始人群页</a>'+(deployments?'<div class="boss-reference">'+deploymentDetails(deployments,deployments.records.filter(r=>r.crowdId===crowd.id))+'</div>':'');
  }
  function crowdDirectory(task) {
    let node=$('ditagCrowdDirectory');
    if(!node){node=document.createElement('div');node.id='ditagCrowdDirectory';$('audiencePackageMeta').appendChild(node);}
    const references=task?.crowdReferences||[];
    node.hidden=!references.length;
    node.innerHTML=references.length?'<strong>PRD 关联 Ditag 人群包</strong><p>关联包资料，不是右侧统计范围。当前人数为人工核验，非自动同步；点击查看规则及历史版本。</p>'+references.map(c=>'<button type="button" class="ditag-crowd-row" data-live-crowd="'+esc(c.id)+'"><span>'+esc(c.prdLabel)+'<small>ID '+esc(c.id)+' · '+esc(c.version)+' · '+esc(c.status)+'</small></span><strong>'+num(c.currentUsers)+' 人</strong></button>').join(''):'';
    all('[data-task-group="recall"] .audience-option').forEach(button=>{
      const c=references.find(c=>c.prdLabel===button.dataset.audience.replaceAll(' ',''));
      button.disabled=!c;
      if(c){delete button.dataset.liveCrowd;button.dataset.liveSelectCrowd=c.id;delete button.dataset.unavailable;button.title='切换到该人群分析';}
      else{delete button.dataset.liveCrowd;delete button.dataset.liveSelectCrowd;button.title='包内效果组合筛选尚未接入；选择召回任务可查看已核验包信息';}
    });
    if(task?.deploymentReference)node.insertAdjacentHTML('beforeend','<button type="button" class="link-button" data-live-deployment="all">查看6条BOSS投放配置</button>');
    text('[data-task-group="recall"] .branch-label','人群分析');
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
    all('#addProfileDrill,#resetProfileDrill,#addDimensionPrompt,#dimensionPrompt').forEach(n=>n.disabled=true);
    all('.apollo-reference,.boss-reference').forEach(n=>{n.hidden=true;n.replaceChildren();});
    for (const id of ['preMetrics','effectMetrics','dailyMetrics','realtimeMetrics']) metric(id,[]);
    for (const id of ['preOverview','effectOverview','movementOverview']) banner(id,'数据尚未就绪',message);
    for (const id of emptyMarkup.keys()) emptyVisual(id,'暂无数据');
    renderFunnel('dailyFunnelVisual',emptyStages,funnel);emptyProfile();
    text('.audience-summary > strong','—'); text('.audience-summary .soft-tag','等待数据');
    text('#breakdownVisualDefinition','累计标签拆解暂未接入');
    text('.realtime-trend-panel .data-note','小时级数据暂未接入');
    text('#profileInsight',message); text('#profileVisualCaption','等待数据');text('#profileDrillPath','等待数据');$('profileScope')?.replaceChildren();
    text('#experimentBalance .status-pill','尚未接入');text('#experimentBalance .section-kicker','实验前检查');$('recheckBalance').disabled=true;
    text('#experimentBalance .balance-insight p','缺少投放前快照和已核验分流配置，暂不输出均衡结论。');
    text('#experimentBalance .balance-summary strong','均衡检查暂未接入');
    text('#experimentBalance .balance-note p','均衡检查尚未接入，暂不判断是否通过。');
    text('#experimentBalance .balance-summary p','保留原检查模块，待对应数据可用后接入。');
    text('#subview-effect > .root-cause-panel .cause-recommend p','累计归属和营销建议暂未接入。');
    for(const selector of ['#dailyFunnelNote','#dailyFunnelPanel .funnel-footnote','#dailyBreakdownPanel .data-note','#dailyInvalidDate'])text(selector,message);
    packageMeta(null);crowdDirectory(null);emptyGaps();$('configureFunnel').disabled=true;
    for(const id of ['breakdownGroupFilter','invalidGroupFilter'])$(id).classList.add('hidden');
    all('#baselineButtons button').forEach(b=>b.disabled=true);
    text('#contextStatus',message); text('.sync-status','未加载');
    $('exportReport').disabled = true;$('exportDailyReport').disabled=true;
    state.ai.answer = null; window.render();
    document.documentElement.dataset.liveReady = 'true';
  }
  const portraitGroupName=(group,kind)=>kind==='coupon'?({treatment_group:'实验组',control_group:'对照组'}[group]||'来源 '+group+' 组'):'来源 '+group+' 组';
  function balance(task) {
    const data=task.groupPortrait;if(!data)return;
    const available=data.dimensions.filter(d=>d.status==='available');
    text('#experimentBalance .section-kicker','当前分组画像');
    text('#experimentBalance .status-pill',available.length===4?'画像已接入':available.length?'部分画像已接入':'暂无画像');
    text('#experimentBalance .balance-insight p','当前来源标签可比较两组分布；这些不是投放前快照，暂不判断实验前是否均衡。');
    text('#experimentBalance .balance-summary strong',data.groups.map(g=>portraitGroupName(g.group,task.kind)+' '+num(g.users)+' 人').join(' / ')||'当前来源暂无分组人数');
    text('#experimentBalance .balance-summary p','快照分区 '+data.partition+(data.cohortDate?' · 进组日 '+data.cohortDate:' · 当前人群包快照')+'；展开查看人数和组内占比，比较始终保留全部来源组。');
    text('#experimentBalance .balance-note p',(task.portraitSource?.overlapUsers>0?'检测到跨组重复 '+num(task.portraitSource.overlapUsers)+' 人，两组并非互斥。':'')+'分布差异仅作描述，不能据此认定随机分流或均衡通过。'+(task.experimentReference?'关联 Apollo 配置已核实为50%/50%，与当前人群的映射仍待核对。':'投放前标签及随机分流配置仍待核验。'));
    const keys=['charge_life_cycle','charge_freq_type','charge_duid_role_name_v2_type','member_status'];
    all('#balanceDimensions details').forEach((node,i)=>{
      const entry=data.dimensions.find(d=>d.key===keys[i]),summary=node.querySelector('summary');
      const ok=entry?.status==='available';
      summary.querySelector('small').textContent=ok?entry.values.length+' 类 · 最大组内占比差':entry?.status==='inconsistent'?'统计不完整，待核查':'暂无该维度数据';
      summary.querySelector('strong').textContent=ok&&Number.isFinite(entry.maxShareGap)?(entry.maxShareGap*100).toFixed(2)+' 个百分点':'—';
      const tag=summary.querySelector('em');tag.className='dimension-reference';tag.textContent=ok?'描述':'待补';
      node.title='当前标签分组分布，不是投放前均衡检验';
      node.querySelector('.enum-table').innerHTML=ok?table(['标签枚举',...data.groups.map(g=>portraitGroupName(g.group,task.kind)+'人数 / 占比')],entry.values.map(v=>[v.value,...data.groups.map(g=>{const cell=v.groups.find(c=>c.group===g.group);return cell?num(cell.users)+' 人 · '+pct(cell.share):'—';})])):'<p>暂无数据 · '+(entry?.status==='inconsistent'?'分组人数与维度合计不一致，不能计算占比。':'该维度尚无可展示的分组统计。')+'</p>';
    });
    $('balanceDimensions').removeAttribute('data-empty-visual');
    $('balanceDimensions').querySelector('.visual-empty-caption')?.remove();
    $('recheckBalance').disabled=false;
  }
  let profilePreferences={};
  try{profilePreferences=window.deliveryOffline?.view.profilePreferences||JSON.parse(sessionStorage.getItem('deliveryProfilePreferences')||'{}');}catch{}
  const profileOptions=task=>{
    const options=task.portraitDimensionOptions||task.dimensionOptions;
    const order=['charge_life_cycle','charge_freq_type','charge_duid_role_name_v2_type','member_status','city_fenkuang','charge_region','city_name'];
    return Object.fromEntries([...order,...Object.keys(options)].filter((k,i,a)=>Object.hasOwn(options,k)&&a.indexOf(k)===i).map(k=>[k,options[k]]));
  };
  const profileDefinitions={
    charge_life_cycle:'按业务生命周期标签分组；与流失天数分组不同',
    charge_freq_type:'按总充电频次标签分组；与安心充购买频次不同',
    charge_duid_role_name_v2_type:'按来源中的车辆身份分类展示；端内／端外分类仅在来源有值时展示',
    member_status:'按会员状态分组；状态未知单独保留，不并入非会员',
    city_fenkuang:'按来源城市分框分组',charge_region:'按来源战区分组',city_name:'按来源高频订单城市分组，与投放城市范围不同',
    activity_cycle:'按召回来源的流失周期分组，与业务生命周期不同',
    ds_freq_type:'按安心充购买频次分层，与总充电频次不同',
  };
  function profileScopeLabel(task){return task.kind==='coupon'?'召回复购 · 进组日 '+task.selectedDate:'安心充低频购买人群 · 快照 '+task.portraitPartition;}
  function renderProfileScope(task){
    let node=$('profileScope');if(!node){node=document.createElement('div');node.id='profileScope';node.className='profile-scope';one('#audienceProfile .audience-summary').insertAdjacentElement('afterend',node);}
    node.innerHTML='<span>'+esc(profileScopeLabel(task)+' · '+(task.selectedGroup==='all'?'全部组':portraitGroupName(task.selectedGroup,task.kind))+(task.portraitSource?.overlapUsers>0?' · 跨组重复 '+num(task.portraitSource.overlapUsers)+' 人，整体已去重':''))+'</span><button type="button" class="link-button" id="profileSourceDetails">查看数据来源与口径</button>';
  }
  function showProfileSource(){
    const task=state.data?.task;if(!task)return;
    const source=task.portraitSource,fields=profilePath(task),options=profileOptions(task);
    text('#dialogTitle','画像数据来源与统计口径');
    $('dialogBody').innerHTML='<p>'+esc(profileScopeLabel(task))+'</p>'+table(['项目','当前取值'],[['来源表',source?.sourceName||'来源信息待更新'],['快照分区',task.portraitPartition],['统计范围',task.kind==='coupon'?'来源任务所选单个进组日；未按左侧Ditag包筛选，不是任务累计或Ditag包全量':'所选人群包当前快照，独立于分日效果日期'],['去重实体','DUID；人数来自源表聚合'],['画像生成时间',source?.builtAt||state.data.builtAt]])+(source?.overlapUsers>0?'<p>检测到跨组重复 '+num(source.overlapUsers)+' 人；全部组画像已跨组独立去重，两组人数不能相加。</p>':'')+'<h4>维度字段</h4>'+table(['页面维度','来源字段'],fields.map(k=>[options[k],k]))+'<h4>实际筛选条件</h4>'+table(['字段','等于'],(source?.filters||[]).map(f=>[f.name,f.value]))+(task.kind==='coupon'?'<p>生命周期读取 charge_life_cycle（老用户、成长期用户等）；流失周期读取 activity_cycle（30–60天、60–90天、90–180天等）。两者是不同分类，不互相替代。来源任务与左侧三个私家车包的成员映射尚未核验，不能把当前结果视作这些包的画像。</p>':'')+'<p>标签名称沿用源表原值；未出现的类别不补成人数，未知状态不当作非会员。高低频阈值与生命周期规则需以源表生产定义为准。</p><p>Demo画像参考的是2026-08-26的安心充低频购买人群214,084人。当前任务、日期或人群不同，人数和分类不能直接对比。</p><p>当前标签不代表投放前状态；上游数据缺失不会用Demo数字替代。</p>';
    $('infoDialog').showModal();
  }
  const profilePath=task=>task.profileAnalysis?.dimensions||[task.portraitDimension||task.dimension];
  function configuredDimensions(task){
    const options=profileOptions(task),saved=profilePreferences[task.id]?.dimensions;
    const chosen=Array.isArray(saved)?saved.filter(k=>Object.hasOwn(options,k)):Object.keys(options);
    return chosen.length?chosen:Object.keys(options);
  }
  function saveProfilePreferences(task,changes){
    profilePreferences[task.id]={...profilePreferences[task.id],...changes};
    try{if(!window.deliveryOffline)sessionStorage.setItem('deliveryProfilePreferences',JSON.stringify(profilePreferences));}catch{}
  }
  function profileFeedback(message){
    let node=$('profileFeedback');if(!node){node=document.createElement('p');node.id='profileFeedback';node.setAttribute('role','status');$('dimensionPrompt').closest('.ask-bar,.dimension-prompt')?.insertAdjacentElement('afterend',node);if(!node.isConnected)$('audienceProfile').appendChild(node);}
    node.textContent=message;
  }
  function chooseProfile(path){
    if(!state.data)return;
    saveProfilePreferences(state.data.task,{path});
    load({...selection,portraitDimension:path[0],profileDimensions:path.join(',')});
  }
  function profileControls(task){
    const options=profileOptions(task),path=profilePath(task),chosen=configuredDimensions(task);
    $('dimensionTabs').innerHTML=chosen.map(k=>'<button type="button" class="'+(k===path[0]?'active':'')+'" data-profile-dimension="'+esc(Object.keys(dimensions).find(name=>dimensions[name]===k)||k)+'" aria-pressed="'+(k===path[0])+'">'+esc(k==='member_status'?'是否会员':options[k])+'</button>').join('');
    text('#profileDrillPath',path.map(k=>options[k]).join(' × '));
    $('addProfileDrill').disabled=path.length>=3||!task.profileCrossDimensions?.includes(path[0]);
    $('addProfileDrill').title=path.length>=3?'最多支持三级维度拆分':!task.profileCrossDimensions?.includes(path[0])?'该维度联合快照暂未准备完成':'增加下一级维度';
    $('resetProfileDrill').classList.toggle('hidden',path.length<2);$('resetProfileDrill').disabled=false;
    $('dimensionPrompt').disabled=false;$('addDimensionPrompt').disabled=false;
    $('dimensionPrompt').placeholder='用自然语言补充维度，例如：再看看城市分框和战区';
    $('profileViewSwitch').classList.remove('hidden');
    const primaryView=one('[data-profile-view="pie"]');if(primaryView)primaryView.lastChild.textContent=path.length>1?' 交叉矩阵':' 饼图';
    all('[data-profile-view]').forEach(n=>{n.classList.toggle('active',n.dataset.profileView===chart);n.setAttribute('aria-selected',String(n.dataset.profileView===chart));});
  }
  function openProfilePicker(){
    const task=state.data?.task;if(!task)return;
    const path=profilePath(task),options=profileOptions(task);
    if(path.length>=3){profileFeedback('最多支持三级维度拆分；可重置后重新选择。');return;}
    const choices=(task.profileCrossDimensions||[]).filter(k=>!path.includes(k)&&configuredDimensions(task).includes(k));
    text('#dialogTitle','选择第 '+(path.length+1)+' 级维度');
    $('dialogBody').innerHTML='<p>当前路径：'+esc(path.map(k=>options[k]).join(' × '))+'</p><p>按同一来源快照的联合人数拆分，展示完整交叉分布。</p><div class="dimension-options">'+choices.map(k=>'<label class="dimension-option"><input type="radio" name="profileDrillDimension" value="'+esc(k)+'"><span>'+esc(options[k])+'</span></label>').join('')+'</div>'+(choices.length?'<button class="primary-button full-button" id="confirmProfileDrill" type="button">继续拆分</button>':'<p>暂无其他已配置且有联合数据的维度；可在配置维度中添加。</p>');
    $('infoDialog').showModal();
  }
  function renderProfileCross(task){
    const a=task.profileAnalysis,options=profileOptions(task),path=a.dimensions;
    text('#profileDimensionTitle',path.map(k=>options[k]).join(' × '));
    text('#profileDimensionDefinition','同一来源快照联合聚合；父级为前 '+(path.length-1)+' 级组合，未用边际比例估算');
    text('#profileVisualCaption','真实交叉人数 · '+(a.rows?.length||0)+' 个非空组合');
    if(a.status!=='available'){emptyVisual('profileBars','联合快照尚未准备完成，请稍后重新分析');text('#profileInsight','暂无可核验的联合统计，不根据单维占比估算。');return;}
    text('#profileInsight','当前 '+num(a.total)+' 人，按 '+path.map(k=>options[k]).join(' × ')+' 展开，共 '+a.rows.length+' 个非空组合。');
    if(!a.rows.length){emptyVisual('profileBars','当前范围没有人群');return;}
    const flattened=a.rows.map(r=>({value:r.values.join(' × '),users:r.users,share:r.share,parentShare:r.parentShare}));
    if(chart==='bar'){
      setVisual('profileBars','<div class="cross-bar-list">'+flattened.map(r=>'<div class="cross-bar-row"><div><strong>'+esc(r.value)+'</strong><small>'+num(r.users)+' 人 · 父级 '+pct(r.parentShare)+'</small></div><div class="cross-bar-track"><b style="width:'+(100*(r.share||0))+'%"></b></div><em>'+pct(r.share)+'</em></div>').join('')+'</div>');return;
    }
    // 默认沿用Demo矩阵；“数据表格”给出所有组合的精确长表，避免高基数矩阵难以阅读。
    if(chart==='table'){setVisual('profileBars',table([...path.map(k=>options[k]),'人数','总体占比','父级占比'],a.rows.map(r=>[...r.values,num(r.users),pct(r.share),pct(r.parentShare)])));return;}
    const columns=[...new Map(a.rows.map(r=>[JSON.stringify(r.values.slice(1)),r.values.slice(1)])).values()];
    const rowNames=[...new Set(a.rows.map(r=>r.values[0]))],lookup=new Map(a.rows.map(r=>[JSON.stringify(r.values),r]));
    const parents=new Map();for(const r of a.rows){const k=JSON.stringify(r.values.slice(0,-1));parents.set(k,(parents.get(k)||0)+r.users);}
    const note='<div class="profile-cross-note">真实联合人数；总体占比以当前人群为分母，父级占比以此前维度组合为分母。零父级比例显示 —。</div>';
    const matrix='<div class="profile-cross-scroll" tabindex="0" role="region" aria-label="交叉维度矩阵，可横向滚动"><table class="profile-cross-table"><thead><tr><th>'+esc(options[path[0]])+'</th>'+columns.map(c=>'<th>'+esc(c.join(' × '))+'</th>').join('')+'<th>行合计</th></tr></thead><tbody>'+rowNames.map(value=>{
      const total=a.rows.filter(r=>r.values[0]===value).reduce((s,r)=>s+r.users,0);
      return '<tr><th scope="row">'+esc(value)+'</th>'+columns.map(c=>{
        const values=[value,...c],cell=lookup.get(JSON.stringify(values)),users=cell?.users||0,parent=parents.get(JSON.stringify(values.slice(0,-1)))||0,share=a.total?users/a.total:null;
        return '<td style="--cross-intensity:'+(.04+.6*(share||0)).toFixed(3)+'"><strong>总体 '+pct(share)+'</strong><small>父级 '+pct(parent?users/parent:null)+' · '+num(users)+' 人</small></td>';
      }).join('')+'<td class="cross-total"><strong>'+pct(total?1:null)+'</strong><small>'+num(total)+' 人</small></td></tr>';
    }).join('')+'</tbody></table></div>';
    setVisual('profileBars',note+matrix);
  }
  function applyProfilePrompt(){
    const task=state.data?.task;if(!task)return;
    const prompt=$('dimensionPrompt').value.trim();if(!prompt){profileFeedback('请输入想看的维度，例如：生命周期和充电频次。');return;}
    const options=profileOptions(task),aliases={charge_life_cycle:['生命周期'],charge_freq_type:['充电频次','充电频率'],charge_duid_role_name_v2_type:['用户身份'],member_status:['会员状态','是否会员'],city_name:['城市'],city_fenkuang:['城市分框'],charge_region:['战区']};
    const textWithoutFrame=prompt.replaceAll('城市分框','□□□□');
    const matches=Object.keys(options).map(k=>{const names=[options[k],...(aliases[k]||[])];const source=k==='city_name'?textWithoutFrame:prompt;const indices=names.map(n=>source.indexOf(n)).filter(i=>i>=0);return {key:k,index:indices.length?Math.min(...indices):-1};}).filter(r=>r.index>=0).sort((a,b)=>a.index-b.index);
    const keys=matches.map(r=>r.key);
    if(!keys.length){profileFeedback('未识别到现有维度，可识别：'+Object.values(options).join('、')+'。');return;}
    const cross=/交叉|拆分|组合|[×*]|按.*再按/.test(prompt);
    if(cross&&(keys.length>3||keys.some(k=>!task.profileCrossDimensions?.includes(k)))){profileFeedback(keys.length>3?'最多支持三级维度，请减少到三个。':'所选维度的联合快照尚不可用，可先查看单维分布。');return;}
    saveProfilePreferences(task,{dimensions:[...new Set([...configuredDimensions(task),...keys])]});
    profileFeedback((cross?'已识别交叉维度：':'已补充维度：')+keys.map(k=>options[k]).join('、')+'。');
    $('dimensionPrompt').value='';chooseProfile(cross?keys:[keys[0]]);
  }

  function profile(task) {
    profileControls(task);renderProfileScope(task);
    const rows = task.portrait, total = rows.reduce((s,r)=>s+r.users,0), label = (task.portraitDimensionOptions||task.dimensionOptions)[task.portraitDimension||task.dimension];
    text('.audience-summary > strong',num(rows.length?total:null)); text('.audience-summary > span',task.kind==='coupon'?'DUID · 当前进组日人群':'DUID · 当前圈选人群');
    text('.audience-summary .soft-tag','分区 '+task.portraitPartition);
    text('#profileDimensionTitle',label);
    text('#profileDimensionDefinition',profileDefinitions[task.portraitDimension||task.dimension]||'按来源标签分组');
    text('#profileVisualCaption',chart === 'table' ? '人数与占比' : '占比结构');
    const scope=task.kind==='coupon'?'当前进组日人群中，':'当前圈选人群中，';
    const frequencyNote=(task.portraitDimension||task.dimension)==='charge_freq_type'?(task.kind==='effect'?'圈选条件是安心充购买频次，图中是总充电频次，二者口径不同。':'此处为召回人群的总充电频次标签。'):'';
    text('#profileInsight',rows.length ? scope+rows[0].value+'占比 '+pct(total ? rows[0].users/total : null)+'，共 '+num(rows[0].users)+' 人。'+frequencyNote : '所选范围暂无画像数据');
    if(task.profileAnalysis?.dimensions.length>1){renderProfileCross(task);return;}
    if (!rows.length) {emptyProfile();return;}
    $('profileBars').removeAttribute('data-empty-visual');
    if (chart === 'table') $('profileBars').innerHTML = table(['标签枚举','人数','占比'],rows.map(r=>[r.value,num(r.users),pct(total?r.users/total:null)]));
    else if (chart === 'bar') $('profileBars').innerHTML = '<div class="profile-bars">'+rows.map(r=>'<div class="profile-bar-row"><span>'+esc(r.value)+'</span><div class="profile-bar-track"><b style="width:'+(total?100*r.users/total:0)+'%"></b></div><strong>'+num(r.users)+'</strong><em>'+pct(total?r.users/total:null)+'</em></div>').join('')+'</div>';
    else {
      const pie = rows.slice(0,5);
      if (rows.length > 5) pie.push({value:'其他',users:rows.slice(5).reduce((s,r)=>s+r.users,0)});
      let offset = 0;
      const segments = pie.map((r,i)=>{const ratio = total ? 100*r.users/total : 0, start=offset; offset+=ratio;return '<circle data-profile-index="'+i+'" class="profile-pie-segment" cx="80" cy="80" r="54" pathLength="100" stroke="'+colors[i]+'" stroke-dasharray="'+ratio+' '+(100-ratio)+'" stroke-dashoffset="'+(-start)+'"><title>'+esc(r.value)+' '+num(r.users)+' 人 · '+pct(total?r.users/total:null)+'</title></circle>';}).join('');
      $('profileBars').innerHTML = '<div class="profile-pie-grid"><div class="profile-pie-chart"><svg class="profile-pie-ring" viewBox="0 0 160 160" aria-label="'+esc(label)+'占比结构"><circle class="profile-pie-track" cx="80" cy="80" r="54"></circle>'+segments+'</svg><div class="profile-pie-detail" aria-live="polite"></div></div><div class="profile-pie-legend">'+pie.map((r,i)=>'<div class="profile-pie-item" role="button" aria-label="'+esc(r.value+'，'+num(r.users)+'人，点击选择下一级维度')+'" tabindex="0" data-profile-index="'+i+'"><i class="profile-pie-swatch" style="background:'+colors[i]+'"></i><strong>'+esc(r.value)+'</strong><small>'+num(r.users)+' · '+pct(total?r.users/total:null)+'</small></div>').join('')+'</div></div>';
    }
  }
  function renderExperimentReference(task,mode) {
    renderDeploymentReference(task,mode);
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
      '<p>'+esc(ref.scopeNote)+'</p><p class="apollo-source">采集日期 '+esc(ref.observedOn)+' · '+esc(ref.captureMode)+' · <a href="'+esc(ref.monitoringURL)+'" target="_blank" rel="noopener noreferrer">查看来源</a></p><details><summary>查看关联核对说明</summary><p>'+esc(ref.identityNote)+'</p><p>'+esc(task.deploymentReference?'BOSS配置已明确三个包分别绑定实验组与对照组；API成员映射仍待核验，分流样本不等于领券或复购人数。':'实验与三个召回人群包、BOSS配置的关联仍待核对；分流样本不等于领券或复购人数。')+'</p></details>';
  }
  function selectedPeriod(task) {
    const period=$('dailyPeriodSelect').value;
    if(period==='custom'){
      const [start,end]=all('#customDateRange input').map(n=>n.value);
      return start&&end&&start<=end?{start,end}:null;
    }
    const end=task.daily.at(-1)?.date;if(!end)return null;
    const start=new Date(end+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-(Number(period||7)-1));
    return {start:start.toISOString().slice(0,10),end};
  }
  function selectedRows(task) {
    const period=selectedPeriod(task);
    return period?task.daily.filter(r=>r.date>=period.start&&r.date<=period.end):[];
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
    // 日均卡跟随周期，点击趋势日期只联动下方明细；缺测日不能当作零。
    const rates=rows.map(r=>r.rate).filter(Number.isFinite);
    const averageUsers=rows.length&&rows.every(r=>Number.isFinite(r.users))?rows.reduce((n,r)=>n+r.users,0)/rows.length:null;
    const averageRate=rates.length?rates.reduce((n,r)=>n+r,0)/rates.length:null;
    const config=state.data?.analysisTask?.effect;
    const target=config?.metric===(coupon?'coupon_repurchase_rate':'order_penetration_rate')&&config.startDate<=selectedPeriod(task).start?config.targetRate:null;
    const delta=Number.isFinite(target)&&Number.isFinite(averageRate)?((averageRate-target)*100).toFixed(2)+'pp':'—';
    metric('dailyMetrics',[[coupon?'日均进组人数':'日均覆盖人数',num(averageUsers),'按 '+rows.length+' 个有数据日计算；不是跨日去重人数'],['日均目标指标',pct(averageRate),task.metric+' · '+rates.length+' 个有效日算术平均'],['与目标差异',delta,Number.isFinite(target)?'活动目标 '+pct(target):'活动整体目标尚未配置'],['有数据日期',num(rows.length),rows.length?rows[0].date+' → '+rows.at(-1).date:'所选周期暂无数据']]);
    text('#dailyChartTitle',metricName+'趋势');
    text('#movementTrend .movement-line-legend','各来源组独立统计 · 点击日期联动下方模块');
    const series = task.groupDaily?.length ? task.groupDaily : [{group:'整体',rows:task.daily}];
    const values = series.flatMap(g=>g.rows.filter(r=>rows.some(d=>d.date===r.date)).map(r=>reach?r.users:r.rate)).filter(Number.isFinite);
    const max = Math.max(reach?1:.01,...values)*1.1;
    let svg='<svg viewBox="0 0 620 240" role="img" aria-label="分日效果趋势"><g class="movement-svg-grid">'+[28,86,144,202].map(y=>'<line x1="70" x2="590" y1="'+y+'" y2="'+y+'"></line>').join('')+'</g><g class="movement-svg-axis">'+[0,1,2,3].map(i=>'<text x="58" y="'+(32+i*58)+'" text-anchor="end">'+(reach?num(Math.round(max*(3-i)/3)):pct(max*(3-i)/3))+'</text>').join('')+'</g>';
    const period=selectedPeriod(task),dayMillis=86400000;
    const startTime=Date.parse(period.start+'T00:00:00Z'),endTime=Date.parse(period.end+'T00:00:00Z');
    const dayCount=Math.round((endTime-startTime)/dayMillis),tickCount=Math.min(dayCount,7);
    const calendar=Array.from({length:tickCount+1},(_,i)=>new Date(startTime+Math.round(i*dayCount/Math.max(tickCount,1))*dayMillis).toISOString().slice(0,10));
    const xPosition=date=>70+(Date.parse(date+'T00:00:00Z')-startTime)*520/Math.max(endTime-startTime,dayMillis);
    const legends=[];
    series.forEach((g,index)=>{
      const name=g.group==='整体'?'整体':groupName(g.group,task.kind);
      legends.push('<span><i style="background:'+colors[index]+'"></i>'+esc(name)+'</span>');
      const data=rows.map(({date})=>{const item=g.rows.find(d=>d.date===date);return {date,x:xPosition(date),value:item?(reach?item.users:item.rate):null};});
      // 缺测点必须断开，不能用直线补成已观测值。
      let points=[];
      const flush=()=>{if(points.length)svg+='<polyline class="movement-line-path '+(index?'movement-line-control':'')+'" style="stroke:'+colors[index]+'" points="'+points.join(' ')+'"></polyline>';points=[];};
      data.forEach((p,i)=>{if(i&&Date.parse(p.date)-Date.parse(data[i-1].date)>dayMillis)flush();if(Number.isFinite(p.value))points.push(p.x+','+(202-174*p.value/max));else flush();});flush();
      svg+='<g class="'+(index?'movement-control-points':'movement-line-points')+'">'+data.filter(p=>Number.isFinite(p.value)).map(p=>'<circle cx="'+p.x+'" cy="'+(202-174*p.value/max)+'" r="'+(index?4:6)+'" style="fill:'+colors[index]+'" tabindex="0" role="button" data-live-date="'+esc(p.date)+'" aria-label="选择 '+esc(p.date)+'"><title>'+esc(p.date)+' · '+esc(name)+' '+(reach?num(p.value):pct(p.value))+'</title></circle>').join('')+'</g>';
    });
    one('#movementTrend .movement-line-legend').innerHTML=legends.join('');
    svg+='<g class="movement-svg-axis">'+calendar.map(date=>'<text x="'+xPosition(date)+'" y="226" text-anchor="middle">'+date.slice(5)+'</text>').join('')+'</g></svg>';
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
    text('#dailyFunnelPanel .section-kicker',coupon?'所选周期 · 发券复购漏斗':'所选周期 · 覆盖与个人达标');
    const available=task.periodFunnels?.dates.filter(date=>date>=period.start&&date<=period.end)||[];
    const periodKey=available.length?available[0]+'/'+available.at(-1):'';
    const interval=task.periodFunnels?.periods[periodKey]?.find(item=>item.group===task.selectedGroup)?.summary;
    text('#dailyFunnelNote',period.start+' → '+period.end+' · '+(interval?'周期内独立去重；点击趋势日期不改变此漏斗':'周期聚合尚未准备完成，保留空值'));
    text('#dailyFunnelPanel .funnel-footnote',interval?(coupon?'完整发券 '+num(interval.full)+' 人，其中复购 '+num(interval.full_repurchase)+' 人；完整发券是独立子集，不拼入主漏斗。':'期间任一日个人达标；不等于活动新增订单。')+' 未提供曝光、点击事件。':'此处需要周期独立去重结果，不用单日数据或分日相加代替。');
    const stages=interval?(coupon?[['周期进组',interval.users],['周期领券',interval.coupon],['领券且 7 日复购',interval.coupon_repurchase]]:[['期间覆盖',interval.users],['期间曾达标',interval.achieved]]):emptyStages;
    renderFunnel('dailyFunnelVisual',stages,funnel);
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
    const config=state.data?.analysisTask?.effect;
    const target=config?.metric===(coupon?'coupon_repurchase_rate':'achievement_rate')&&config.startDate===c.startDate?config.targetRate:null;
    metric('effectMetrics',[
      [coupon?'累计去重进组人数':'期间去重覆盖人数',num(s.users),range],
      [c.metric,pct(s.rate),num(s.success)+' / '+num(s.eligible)],
      [coupon?'累计领券人数':'期间曾达标人数',num(coupon?s.coupon:s.success),coupon?'跨进组日按DUID去重':'统计期内任一日达标'],
      [coupon?'领券后未复购人数':'期间从未达标人数',num(s.unmet),'当前范围内集合差'],
      [treatment?groupName(treatment.group,task.kind)+'累计效果':'来源组累计效果',pct(treatment?.rate),num(treatment?.users)+' 人'],
      [control?groupName(control.group,task.kind)+'累计效果':'另一来源组累计效果',pct(control?.rate),'前组减后组 '+difference],
      ['活动目标',pct(target),Number.isFinite(target)?'用户配置 · 与当前累计指标和起始日一致':config?'配置指标或起始日与累计范围不一致':'尚未配置活动目标'],
      ['目标达成率',pct(Number.isFinite(target)&&target>0&&Number.isFinite(s.rate)?s.rate/target:null),Number.isFinite(target)&&Number.isFinite(s.rate)?'实际效果减目标 '+((s.rate-target)*100).toFixed(2)+'pp':'等待同口径目标'],
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
    if(t.scopeUnavailable){
      clearData(t.scopeUnavailable);crowdDirectory(t);
      const node=all('[data-live-select-crowd]').find(n=>n.dataset.liveSelectCrowd===t.selectedCrowd.id);if(node)selectTree(node);
      text('#contextInputName',t.selectedCrowd.prdLabel+' · '+t.selectedCrowd.id);text('#contextStatus','人群已选择 · 分析数据待关联');
      banner('preOverview',t.selectedCrowd.prdLabel,t.scopeUnavailable);
      banner('effectOverview','所选人群效果尚未接入',t.scopeUnavailable);
      banner('movementOverview','所选人群分日效果尚未接入',t.scopeUnavailable);
      notice(t.scopeUnavailable+' Ditag资料入口可查看当前规则和人数；不会用任务全量回填。');
      window.dispatchEvent(new CustomEvent('delivery:data'));return;
    }
    const originalId=t.id==='coupon'?'recall':'summer';
    all('.task-node').forEach(n=>n.classList.toggle('active',n.dataset.task===originalId));
    all('.task-group').forEach(n=>n.classList.toggle('active',n.dataset.taskGroup===originalId));
    all('.audience-option').forEach(n=>n.classList.toggle('active',t.id==='effect'&&n.closest('.task-group').dataset.taskGroup==='summer'));
    all('.audience-option svg[data-lucide="check"]').forEach(n=>n.style.display=n.closest('.audience-option').classList.contains('active')?'':'none');
    text('#contextTaskName',d.analysisTask?.name || one('[data-task="'+originalId+'"]').dataset.taskName);
    text('#contextInputName',t.id==='effect'?'近30天安心充低频购买用户':'进组日 '+t.selectedDate+' · 任务 '+t.sourceTaskId);
    text('#contextStatus','真实数据 · '+t.selectedDate);
    text('.mock-badge',window.deliveryOffline?'离线交互报告':'服务器真实数据');text('.sync-status','快照 '+new Date(d.builtAt).toLocaleString('zh-CN',{hour12:false}));
    packageMeta(t);crowdDirectory(t);emptyGaps();
    text('#historyReference .data-note','当前目标：'+t.metric);
    notice((d.status.lastError?d.status.lastError+'；保留上次快照。':'')+t.notes.join(' '));
    const groups=t.portraitGroups || t.groupSummary;
    const total=t.portrait.reduce((sum,r)=>sum+r.users,0);
    metric('preMetrics',[['目标人群',num(t.portrait.length?total:null),'当前来源快照'],[groups[0]?groupName(groups[0].group,t.kind):'A组人数',num(groups[0]?.users),'来源分组'],[groups[1]?groupName(groups[1].group,t.kind):'B组人数',num(groups[1]?.users),'来源分组'],['均衡检查','—','投放前数据尚未接入']]);
    text('#preOverview .section-kicker','当前数据概览');
    banner('preOverview',t.portrait.length?'当前来源人群共 '+num(total)+' 人':'当前来源人群暂无数据','已接入画像与分日效果。投放前均衡检查、历史活动对比等待对应数据，不输出推测结论。');
    banner('effectOverview','跨日累计暂未接入','各日人数及滚动订单不可直接累加；请在原“分日效果”页签查看真实数据。');
    text('#effectSettings .baseline-label','累计口径');text('#baselineSelection','累计基准暂未接入');
    $('configureFunnel').disabled=!t.cumulative;balance(t);profile(t);daily(t);cumulative(t);$('exportReport').disabled=false;$('exportDailyReport').disabled=false;
    window.dispatchEvent(new CustomEvent('delivery:data'));
    for(const attr of ['profile-dimension','daily-breakdown'])all('[data-'+attr+']').forEach(n=>n.classList.toggle('active',(dimensions[n.getAttribute('data-'+attr)]||n.getAttribute('data-'+attr))===(attr==='profile-dimension'?(t.portraitDimension||t.dimension):t.dimension)));
  }
  async function load(next=selection) {
    if(next.unsupported){unsupported(next.unsupported);return;}
    const changedTask=next.taskId!==selection.taskId;
    if(changedTask){const saved=profilePreferences[next.taskId];const path=saved?.path||saved?.dimensions?.slice(0,1);if(path?.length)next={...next,portraitDimension:path[0],profileDimensions:path.join(',')};chart=saved?.chart||'pie';all('#customDateRange input').forEach(n=>delete n.dataset.initialized);$('dailyPeriodSelect').value='7';$('customDateRange').classList.add('hidden');}
    const version=++state.request;selection=next;state.data=null;clearData('正在读取真实数据…');notice('正在读取真实数据…');
    try {
      const data=window.deliveryAPI?await window.deliveryAPI.bootstrap(next):await (async()=>{const response=await fetch('/api/bootstrap?'+new URLSearchParams(next),{headers:{Authorization:'Bearer '+(localStorage.getItem('di_agent_token')||'')}});const data=await response.json();if(!response.ok)throw new Error(data.error||'读取失败');return data;})();
      if(version!==state.request)return;if(data.env!=='live')throw new Error('接口未返回真实数据');
      state.data=data;selection={taskId:data.analysisTask?.id||data.task.id,...(data.task.selectedCrowd?{crowdId:data.task.selectedCrowd.id}:{}),...(data.task.selectedDate?{date:data.task.selectedDate}:{} ),group:data.task.selectedGroup,dimension:data.task.dimension,...(data.task.cumulative?{cumulativeGroup:data.task.cumulative.selectedGroup,cumulativeDimension:data.task.cumulative.dimension}:{}),...(data.task.portraitDimension?{portraitDimension:data.task.portraitDimension}:{}),...(data.task.profileAnalysis?{profileDimensions:data.task.profileAnalysis.dimensions.join(',')}:{})};
      try{if(!window.deliveryOffline)sessionStorage.setItem('deliveryOriginalSelection',JSON.stringify(selection));}catch{}
      text('#dailyMetricSelect option[value="firstOrderRate"]',data.task.metric);
      const dates=all('#customDateRange input');if(dates[0]&&data.task.daily.length&&!dates[0].dataset.initialized){dates[0].value=data.task.daily[0].date;dates[1].value=data.task.daily.at(-1).date;dates.forEach(n=>n.dataset.initialized='true');}
      chart=profilePreferences[data.task.id]?.chart||chart;
      renderData();
    }catch(error){if(version!==state.request)return;clearData(error.message);notice(error.message+'；请点击重新分析重试。');}
  }
  function unsupported(message) {
    ++state.request;selection={unsupported:message,unknownTask:one('.task-node.active')?.dataset.task,unknownAudience:one('.audience-option.active')?.dataset.audience};state.data=null;
    try{if(!window.deliveryOffline)sessionStorage.setItem('deliveryOriginalSelection',JSON.stringify(selection));}catch{}
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
  window.deliveryContext=()=>state.data?.task.scopeUnavailable?JSON.stringify({crowd:state.data.task.selectedCrowd,unavailable:state.data.task.scopeUnavailable}):state.data?JSON.stringify({task:state.data.task.sourceTaskId,taskName:state.data.task.name,kind:state.data.task.kind,builtAt:state.data.builtAt,partition:state.data.task.partition,selectedGroup:state.data.task.selectedGroup,profileAnalysis:state.data.task.profileAnalysis,distribution:state.data.task.distribution,groupSummary:state.data.task.groupSummary,evidence:state.data.task.evidence,date:state.data.task.selectedDate,dimension:state.data.task.dimension,portraitDimension:state.data.task.portraitDimension,portrait:state.data.task.portrait.slice(0,50),portraitRowsTotal:state.data.task.portrait.length,portraitUsers:state.data.task.portrait.reduce((sum,row)=>sum+row.users,0),audienceFacts:state.data.task.audienceFacts,summary:state.data.task.summary,cumulative:state.data.task.cumulative,experimentReference:state.data.task.experimentReference,groupPortrait:state.data.task.groupPortrait,crowdReferences:state.data.task.crowdReferences,deploymentReference:state.data.task.deploymentReference,notes:state.data.task.notes}):'当前未选择已接入的数据';
  window.askAi=async question=>{state.ai={question,answer:{title:'分析暂不可用',answer:'当前没有可用 Agent，请先连接 Agent 后重试。'}};window.render();};
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
  function showAnalysisEvidence(buttonId) {
    const current=state.data,task=current?.task;if(!task){notice('当前暂无查询依据');return;}
    if(buttonId==='showConclusionEvidence'){showProfileSource();return;}
    const dailyMode=buttonId==='showMovementEvidence',scope=dailyMode?task:task.cumulative;
    const rows=dailyMode?selectedRows(task):[],valid=!dailyMode||rows.some(r=>r.date===task.selectedDate);
    const summary=valid?scope?.summary:null;
    text('#dialogTitle',dailyMode?'分日分析依据':'累计分析依据');
    const group=dailyMode?task.selectedGroup:scope?.selectedGroup;
    const period=dailyMode?selectedPeriod(task):null;
    const range=dailyMode?(period?period.start+' → '+period.end:'无有效周期'):(scope?scope.startDate+' → '+scope.endDate:'暂无累计数据');
    const numerator=dailyMode?(task.kind==='coupon'?summary?.coupon_repurchase:summary?.axc):summary?.success;
    const denominator=dailyMode?(task.kind==='coupon'?summary?.coupon:summary?.charge):summary?.eligible;
    const denominatorLabel=dailyMode&&task.kind!=='coupon'?'充电订单合计':task.kind==='coupon'?'领券人数':'期间覆盖人数';
    const queries=task.evidence||[];
    $('dialogBody').innerHTML=table(['项目','依据'],[
      ['来源表',task.sourceName],['来源任务 / 人群标识',task.sourceTaskId],['数据分区',task.partition],['生成时间',current.builtAt],
      ['分析周期',range],['当前组别',group==='all'?'整体':groupName(group,task.kind)],['画像 / 明细所选日期',dailyMode?(valid?task.selectedDate:'所选范围暂无数据'):'整个累计周期'],
      ['效果指标',dailyMode?task.metric:scope?.metric],['成功分子',num(numerator)],['分母 · '+denominatorLabel,num(denominator)],
      ['当前效果',pct(summary?.rate)],['配置目标（不一定适用于当前范围）',Number.isFinite(current.analysisTask?.effect?.targetRate)?pct(current.analysisTask.effect.targetRate)+' · '+({coupon_repurchase_rate:'发券后7日复购率',order_penetration_rate:'近30天订单渗透率',achievement_rate:'累计个人达标率'}[current.analysisTask.effect.metric])+' · 起始 '+current.analysisTask.effect.startDate+'；仅在指标与时间口径一致时比较':'尚未配置'],
      ['对比基准','仅已接入来源组；大盘与可比历史活动未接入'],
    ])+'<p>'+esc(dailyMode?'上方日均卡按周期内有效日期算术平均；本表效果及下方画像为当前选中日期，不能当作累计效果。':scope?.note||'累计数据未接入')+'</p><p>'+esc(task.notes.join(' '))+'</p><h4>标签及未达成人群依据</h4>'+table(['标签','人数','未达成'],(dailyMode?(valid?task.distribution:[]):scope?.distribution||[]).map(r=>[r.value,num(r.users),num(r.unmet)]))+'<h4>来源聚合查询 · '+queries.length+' 条</h4><p>这些是构建已发布快照的查询；页面筛选读取快照，不在点击时重新扫描源表。此处展示前50条，完整依据保留在导出快照。</p>'+queries.slice(0,50).map(q=>'<details><summary>'+esc(q.queryId||'来源查询')+' · '+esc(q.durationMs??'—')+' ms</summary><pre class="analysis-query">'+esc(JSON.stringify(q.query,null,2))+'</pre></details>').join('');
    $('infoDialog').showModal();
  }
  function markUnavailable() {
    const pending=[
      ['[data-add-audience-task],.audience-actions button','缺少任务/人群管理接口，见数据范围'],
      ['#selectHistoryActivity,#changeHistoryActivity,#viewHistoryMatch,#viewHistoryBreakdown,#historyFilter,#runHistory,#createCandidate,#viewSnapshot','缺少可比历史活动数据'],
      ['[data-task="activation"],[data-task-group="activation"] .audience-option','尚未接入该任务的数据'],

    ];
    pending.forEach(([selector,reason])=>all(selector).forEach(n=>{n.disabled=true;n.title=reason;n.dataset.unavailable=reason;}));

  }
  function init() {
    if(initialized)return;initialized=true;
    // 原树和所有模块保留；不支持的组合只显示未接入，不能套用全量数据。
    text('#movementSettings p','折线图展示所选日历周期，指标卡展示有效日期的日均值；点击某日联动该日画像，缺测日不补零。');
    $('movementTrend').before($('dailyFunnelPanel'));
    text('.mock-badge','服务器真实数据');text('#toast','');markUnavailable();text('#viewBalanceRule','查看数据口径');$('recheckBalance').lastChild.textContent='刷新当前画像';$('configureFunnel').lastChild.textContent='查看口径';
    text('[data-task="summer"] small','安心充权益 / 来源分组');
    all('[data-task-type]').forEach(n=>n.dataset.taskType=n.dataset.task==='summer'?'来源分组 / 真实数据':n.dataset.taskType);
    all('#dailyMetricSelect option').forEach(n=>{if(['exposureRate','clickRate'].includes(n.value)){n.disabled=true;if(!n.textContent.includes('（未接入）'))n.textContent+='（未接入）';}});
    document.addEventListener('click',event=>{
      const n=event.target.closest('button,[data-live-date],.profile-pie-item,.profile-pie-segment');if(!n)return;
      if(n.classList.contains('funnel-stage')){event.stopImmediatePropagation();text('#dialogTitle',n.querySelector('span').textContent);$('dialogBody').innerHTML='<p>人数：'+esc(n.querySelector('strong').textContent)+'；占首阶段比例：'+esc(n.querySelector('em').textContent)+'</p><p>'+esc(n.closest('section').querySelector('.funnel-definition-note')?.textContent||'当前所选日期与人群范围')+'</p><p>基于源表阶段标记按 DUID 去重；此处展示集合关系，不代表新增订单或因果增量。</p>';$('infoDialog').showModal();return;}
      if(n.dataset.liveDeployment&&state.data?.task.deploymentReference){event.stopImmediatePropagation();text('#dialogTitle','BOSS投放配置');$('dialogBody').innerHTML=deploymentDetails(state.data.task.deploymentReference);$('infoDialog').showModal();return;}
      if(n.dataset.liveSelectCrowd){event.stopImmediatePropagation();selectTree(n);load({taskId:'coupon',crowdId:n.dataset.liveSelectCrowd});return;}
      if(n.dataset.liveCrowd){event.stopImmediatePropagation();const crowd=state.data?.task.crowdReferences?.find(c=>c.id===n.dataset.liveCrowd);if(crowd){text('#dialogTitle',crowd.prdLabel+' · Ditag详情');$('dialogBody').innerHTML=crowdDetails(crowd,state.data.task.deploymentReference);$('infoDialog').showModal();}return;}
      if(n.dataset.task){event.stopImmediatePropagation();selectTree(n);const id={summer:'effect',recall:'coupon'}[n.dataset.task];if(id)load({taskId:id});else{unsupported('该任务尚未接入真实数据');text('#contextTaskName',n.dataset.taskName);}return;}
      if(n.classList.contains('audience-option')){event.stopImmediatePropagation();selectTree(n);if(n.closest('.task-group').dataset.taskGroup==='summer')load({taskId:'effect'});else{unsupported('该人群的组合筛选尚未接入，点击召回任务名称可查看任务全量数据。');text('#contextInputName',n.dataset.audience);}return;}
      if(n.dataset.profileDimension){event.stopImmediatePropagation();chooseProfile([dimensions[n.dataset.profileDimension]||n.dataset.profileDimension]);return;}
      if(n.dataset.dailyBreakdown){if(state.data)load({...selection,dimension:dimensions[n.dataset.dailyBreakdown]});}
      if(n.dataset.livePortrait&&state.data){event.stopImmediatePropagation();$('infoDialog').close();load({...selection,portraitDimension:n.dataset.livePortrait});return;}
      if(n.dataset.liveBreakdown&&state.data){event.stopImmediatePropagation();$('infoDialog').close();load({...selection,dimension:n.dataset.liveBreakdown});return;}
      if(n.id==='configureDimensions'){
        event.stopImmediatePropagation();const task=state.data?.task;
        if(!task){profileFeedback('当前没有可配置的真实数据');return;}
        const options=profileOptions(task),chosen=configuredDimensions(task);
        text('#dialogTitle','配置画像维度');
        $('dialogBody').innerHTML='<p>选择要展示的画像维度，至少保留一个。联合拆分支持已准备好的快照维度；额外日期与ID字段仅支持单维查看。</p><div class="dimension-options">'+Object.entries(options).map(([key,label])=>'<label class="dimension-option"><input type="checkbox" data-live-portrait="'+esc(key)+'" value="'+esc(key)+'" '+(chosen.includes(key)?'checked':'')+'><span>'+esc(label)+'</span></label>').join('')+'</div><p role="status" id="profileDialogFeedback"></p><button class="primary-button full-button" type="button" id="confirmDimensions">应用维度配置</button>';
        $('dialogBody').insertAdjacentHTML('beforeend','<h4>分日效果拆解（独立设置）</h4><div class="profile-dimensions">'+Object.entries(task.dimensionOptions).map(([key,label])=>'<button type="button" class="secondary-button compact-button" data-live-breakdown="'+esc(key)+'">'+esc(label)+'</button>').join('')+'</div>');
        $('infoDialog').showModal();return;
      }
      if(n.id==='confirmDimensions'){
        event.stopImmediatePropagation();const task=state.data?.task;if(!task)return;
        const chosen=all('#dialogBody input:checked').map(n=>n.value);
        if(!chosen.length){text('#profileDialogFeedback','至少选择一个分析维度');return;}
        saveProfilePreferences(task,{dimensions:chosen});$('infoDialog').close();
        chooseProfile([chosen.includes(profilePath(task)[0])?profilePath(task)[0]:chosen[0]]);return;
      }
      if(n.id==='addProfileDrill'||n.classList.contains('profile-pie-item')||n.classList.contains('profile-pie-segment')){event.stopImmediatePropagation();openProfilePicker();return;}
      if(n.id==='confirmProfileDrill'){
        event.stopImmediatePropagation();const selected=one('#dialogBody input[name="profileDrillDimension"]:checked');
        if(!selected){let hint=$('profilePickerHint');if(!hint){hint=document.createElement('p');hint.id='profilePickerHint';hint.setAttribute('role','status');$('dialogBody').appendChild(hint);}hint.textContent='请选择一个维度';return;}
        const path=profilePath(state.data.task);$('infoDialog').close();chooseProfile([...path,selected.value]);return;
      }
      if(n.id==='resetProfileDrill'){event.stopImmediatePropagation();if(state.data)chooseProfile([profilePath(state.data.task)[0]]);return;}
      if(n.id==='addDimensionPrompt'){event.stopImmediatePropagation();applyProfilePrompt();return;}
      if(n.dataset.profileView){event.stopImmediatePropagation();chart=n.dataset.profileView;if(state.data){saveProfilePreferences(state.data.task,{chart});renderData();}else emptyProfile();return;}
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
      if(n.id==='recheckBalance'){event.stopImmediatePropagation();load();return;}
      if(n.id==='viewBalanceRule'){
        event.stopImmediatePropagation();const data=state.data?.task.groupPortrait;
        text('#dialogTitle','当前分组画像口径');
        $('dialogBody').innerHTML='<p>当前标签不是投放前快照，不输出均衡通过、显著性或因果结论。</p><p>组内占比 = 该组该标签人数 / 该组总人数；最大组内占比差 = 各枚举在两组中占比绝对差的最大值，单位为百分点。零分母显示 —；缺失或不守恒的维度不计算。</p><p>'+esc(data?'来源：'+data.sourceName+'；分区：'+data.partition+(data.cohortDate?'；进组日：'+data.cohortDate:'；当前人群包快照'):'当前尚未加载画像')+'</p><p>本模块始终比较全部来源组；刷新读取服务器最近已发布快照，不触发上游任务重算。</p>';$('infoDialog').showModal();return;
      }
      if(n.id==='refreshAnalysis'&&!window.deliveryActions){event.stopImmediatePropagation();load();}
      if(n.id==='exportReport'&&!window.deliveryActions){event.stopImmediatePropagation();notice('导出组件未加载，请刷新页面重试');}
      if(['openApiGuide','openDataNote','openHelp'].includes(n.id)) {
        event.stopImmediatePropagation();
        text('#dialogTitle',n.textContent.trim());
        const task=state.data?.task;
        $('dialogBody').innerHTML='<p>页面以服务器 API 聚合快照为准。有值展示真实统计，缺少数据展示 — 或暂无数据。</p>'+table(['模块','当前接入情况'],[
          ['人群画像、分日效果、单维度拆解','已接入；以所选任务和日期为准'],
          ['召回复购发券漏斗','已接入任务全量；分层人群组合暂无数据'],
          ['实验分组均衡','当前分组画像已接入；投放前快照与均衡结论仍待核验'],['累计效果','跨日按DUID独立去重；支持分组、标签及真实漏斗'],['整体活动目标、大盘与历史基准','缺少对应配置或数据；源表个人目标不能替代'],
          ['资源位曝光、点击','暂无数据'],['历史活动对比、下次投放建议','暂无数据'],
          ['数据来源标识','已使用 crowd_id / source_task_id 限定数据；源标识见下方'],['Ditag人群包资料','召回3包的ID、状态、人数、有效期、规则已录入；创建人及通用管理接口待补'],['BOSS活动配置','召回6条配置已录入，按人群包/实验组关联；资源记录ID、券批次映射及整体目标值待补']
        ])+'<p>'+esc(task?'当前来源：'+task.sourceName+'；分区：'+task.partition+'。 '+task.notes.join(' '):'当前选择暂无已接入数据。')+'</p>';
        $('dialogBody').insertAdjacentHTML('beforeend','<h4>PRD 尚缺的6类数据/配置</h4>'+table(['类别','影响'],[
          ['人群包目录与管理信息','搜索人群、任务关联、包状态/有效期、修改删除'],['实验与活动配置剩余缺口','包与实验组配置关系、配置日期和下线记录已知；实际成员、稳定分组、券批次及整体目标仍待核验'],['投放前标签快照','实验均衡与前置画像'],['同口径大盘基准','大盘效果及差异'],['曝光点击事件','资源位曝光/点击漏斗与指标'],['可比历史活动','历史验证、变化差、历史基准']
        ])+'<p>画像支持三级联合拆分与自然语言选维度；效果组合下钻仍缺实现；日报沿用可离线打开的交互HTML格式。暂不可用入口已标明原因；置灰不代表需求已完成。投放期新增订单/收入另需增量订单口径。</p>');
        if(task)$('dialogBody').insertAdjacentHTML('beforeend',fieldDetails(task));
        $('infoDialog').showModal();return;
      }
      if(n.id==='profileSourceDetails'){event.stopImmediatePropagation();showProfileSource();return;}
      if(n.id==='closeDialog'){$('infoDialog').close();return;}
      const evidence=['showConclusionEvidence','showMovementEvidence','showMonitorEvidence'];
      if(evidence.includes(n.id)){event.stopImmediatePropagation();showAnalysisEvidence(n.id);return;}
      const deferred=['customBreakdownDimension','selectHistoryActivity','configureFunnel'];
      if(deferred.includes(n.id)){event.stopImmediatePropagation();notice('该能力所需数据或配置尚未接入；当前可使用原有画像维度和分日效果。');}
    },true);
    document.addEventListener('keydown',event=>{const n=event.target.closest('[data-live-date]');if(n&&['Enter',' '].includes(event.key)){event.preventDefault();if(state.data)load({...selection,date:n.dataset.liveDate});}});
    const updatePeriod=()=>{
      $('customDateRange').classList.toggle('hidden',$('dailyPeriodSelect').value!=='custom');
      const task=state.data?.task,rows=task?selectedRows(task):[];
      if(rows.length && !rows.some(r=>r.date===task.selectedDate))load({...selection,date:rows.at(-1).date});else renderData();
    };
    $('dimensionPrompt').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();applyProfilePrompt();}});
    $('profileBars').addEventListener('keydown',event=>{if(event.target.closest('.profile-pie-item')&&['Enter',' '].includes(event.key)){event.preventDefault();openProfilePicker();}});
    const highlight=event=>{const item=event.target.closest('[data-profile-index]');if(!item)return;all('#profileBars [data-profile-index]').forEach(n=>n.classList.toggle('is-active',n.dataset.profileIndex===item.dataset.profileIndex));text('#profileBars .profile-pie-detail',one('#profileBars .profile-pie-item[data-profile-index="'+item.dataset.profileIndex+'"]')?.textContent||'');};
    $('profileBars').addEventListener('mouseover',highlight);$('profileBars').addEventListener('focusin',highlight);
    const unhighlight=()=>{all('#profileBars .is-active').forEach(n=>n.classList.remove('is-active'));text('#profileBars .profile-pie-detail','');};
    $('profileBars').addEventListener('mouseleave',unhighlight);$('profileBars').addEventListener('focusout',unhighlight);
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
    if(!window.deliveryOffline)try{selection=JSON.parse(sessionStorage.getItem('deliveryOriginalSelection')||'null')||selection;}catch{}
    if(selection.unsupported){
      const group=all('.task-group').find(n=>n.dataset.taskGroup===selection.unknownTask);
      const node=group&&(Array.from(group.querySelectorAll('.audience-option')).find(n=>n.dataset.audience===selection.unknownAudience)||group.querySelector('.task-node'));
      if(node)selectTree(node);
    }
    load();
  }
  window.deliveryLive={load,selection:()=>({...selection}),view:()=>({chart,funnel,resourceFunnel,phase:one('#stageTabs .active')?.dataset.phase,effect:one('#effectViewTabs .active')?.dataset.effectView,period:$('dailyPeriodSelect').value,metric:$('dailyMetricSelect').value,dates:all('#customDateRange input').map(n=>n.value),profilePreferences}),restoreView(view){profilePreferences=view.profilePreferences||profilePreferences;chart=view.chart||chart;funnel=view.funnel||funnel;resourceFunnel=view.resourceFunnel||resourceFunnel;$('dailyPeriodSelect').value=view.period||'7';if(view.metric)$('dailyMetricSelect').value=view.metric;all('#customDateRange input').forEach((n,i)=>{if(view.dates?.[i])n.value=view.dates[i];});$('customDateRange').classList.toggle('hidden',$('dailyPeriodSelect').value!=='custom');renderData();}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

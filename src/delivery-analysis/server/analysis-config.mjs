import {crowdReferences} from './crowd-reference.mjs';
export const METRICS={coupon:[{id:'coupon_repurchase_rate',label:'发券后 7 日复购率',unit:'rate'}],effect:[{id:'order_penetration_rate',label:'近 30 天订单渗透率',unit:'rate'},{id:'achievement_rate',label:'累计个人达标率',unit:'rate'}]};
export const OBSERVED=[{id:'users',label:'进组 / 覆盖人数'},{id:'coupon',label:'领券人数'},{id:'repurchase',label:'复购人数'},{id:'achieved',label:'个人达标人数'}];
const fail=message=>{throw Object.assign(new Error(message),{code:400});};
export const crowdURL=id=>'https://ditag.intra.xiaojukeji.com/new-system/#/application/crowdDetail?id='+encodeURIComponent(id)+'&crowdUserType=normal&view=filter';
export function crowdCatalog(snapshot){
  const records=(snapshot?.tasks||[]).flatMap(crowdReferences);
  return [...new Map(records.map(c=>[c.id,{id:c.id,name:c.name,sourceURL:c.sourceURL,verified:true,observedOn:c.observedOn}])).values()];
}
export function validateAnalysis(input,kind,{requireCrowd=true}={}){
  const name=typeof input.name==='string'?input.name.trim():'';
  if(!name||name.length>80)fail('分析名称需为 1–80 个字符');
  const crowdId=typeof input.crowdId==='string'?input.crowdId.trim():'';
  if((requireCrowd||crowdId)&&!/^\d{1,30}$/.test(crowdId))fail('请填写新系统的数字人群包 ID');
  const effect=input.effect;
  if(!effect||!METRICS[kind]?.some(m=>m.id===effect.metric))fail('请选择与当前数据源一致的目标效果指标');
  const observed=effect.observedMetrics;
  const allowed=kind==='coupon'?['users','coupon','repurchase']:['users','achieved'];
  if(!Array.isArray(observed)||new Set(observed).size!==observed.length||observed.some(m=>!allowed.includes(m)))fail('观测指标不在当前数据源范围内');
  if(effect.targetRate!==null&&(!Number.isFinite(effect.targetRate)||effect.targetRate<0||effect.targetRate>1))fail('目标值需为 0%–100%，未知时留空');
  const date=effect.startDate;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail('请填写有效的投放起始日期');
  const exp=input.experiment;
  if(!exp||typeof exp.enabled!=='boolean')fail('请设置是否为分组实验');
  const groups=exp.enabled?exp.groups:[];
  if(!Array.isArray(groups)||groups.length>20||(exp.enabled&&groups.length<2))fail('分组实验至少填写两个分组人群包，最多 20 组');
  if(exp.enabled&&!crowdId)fail('分组实验必须填写整体人群包 ID');
  const clean=groups.map(g=>{
    if(typeof g.name!=='string'||!g.name.trim()||g.name.trim().length>50||!/^\d{1,30}$/.test(g.crowdId||''))fail('每组都需填写组名和有效人群包 ID');
    if(g.crowdId===crowdId)fail('整体人群包不能同时作为分组人群包');
    return {name:g.name.trim(),crowdId:g.crowdId};
  });
  if(new Set(clean.map(g=>g.crowdId)).size!==clean.length||new Set(clean.map(g=>g.name)).size!==clean.length)fail('分组名称和人群包 ID 不可重复');
  let experimentURL='';
  if(exp.url){try{const url=new URL(exp.url);if(url.protocol!=='https:'||url.hostname!=='x.intra.xiaojukeji.com'||url.username||url.password||url.href.includes('/undefined'))throw new Error();experimentURL=url.href;}catch{fail('请填写有效的 AB Master HTTPS 实验链接');}}
  return {name,crowdId:crowdId||null,effect:{metric:effect.metric,observedMetrics:observed,targetRate:effect.targetRate,startDate:date},experiment:{enabled:exp.enabled,overallCrowdId:exp.enabled?crowdId:'',groups:clean,url:experimentURL}};
}

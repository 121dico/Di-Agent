import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateAnalysis} from './analysis-config.mjs';
import {crowdReferences} from './crowd-reference.mjs';

export const MODULES=[
  ['preOverview','洞察结论','pre'],['preMetrics','核心指标','pre'],['audienceProfile','基本画像','pre'],['experimentBalance','当前分组画像','pre'],['historyReference','历史活动验证','pre'],
  ['movementOverview','分日结论','monitor'],['dailyMetrics','分日指标卡','monitor'],['dailyFunnelPanel','周期漏斗','monitor'],['movementTrend','分日趋势','monitor'],['dailyBreakdownPanel','分日标签拆解','monitor'],['dailyInvalidPanel','所选日未达成画像','monitor'],
  ['effectOverview','累计结论','monitor'],['effectMetrics','累计指标','monitor'],['resourceFunnelPanel','转化漏斗','monitor'],['effectBreakdown','累计标签拆解','monitor'],['cumulativeCausePanel','未达成画像','monitor'],['subview-movement','分日效果','monitor'],['effectHistoryComparison','历史活动对比','monitor'],
].map(([id,label,phase])=>({id,label,phase}));
export const DAILY_MODULES=['movementOverview','dailyMetrics','dailyFunnelPanel','movementTrend','dailyBreakdownPanel','dailyInvalidPanel'];
const DEFAULT_MODULES=MODULES.map(m=>m.id);
const normalizeModules=(modules,version)=>{const chosen=modules||DEFAULT_MODULES;return version===2||!chosen.includes('subview-movement')?chosen:[...new Set([...chosen,...DAILY_MODULES])];};
const fail=(message,code=400)=>{throw Object.assign(new Error(message),{code});};
export function validateModules(value){
  if(!Array.isArray(value)||!value.length||value.length>DEFAULT_MODULES.length||value.some(id=>!DEFAULT_MODULES.includes(id))||new Set(value).size!==value.length)fail('至少选择一个有效分析模块');
  return value.some(id=>DAILY_MODULES.includes(id))&&!value.includes('subview-movement')?[...value,'subview-movement']:[...value];
}
export class AnalysisTasks {
  constructor(directory){this.directory=directory;this.users={};this.queue=Promise.resolve();}
  async load(){try{this.users=JSON.parse(await readFile(join(this.directory,'analysis-tasks.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  list(user,snapshot){
    const saved=this.users[user]||{items:[],modules:{}};
    const seeds=(snapshot?.tasks||[]).flatMap(t=>crowdReferences(t).map(c=>({id:'crowd-'+c.id,parentId:t.id,sourceId:t.id,name:c.prdLabel,crowdId:c.id,purpose:'召回',seed:true,modules:[...DEFAULT_MODULES]}))).filter(t=>!saved.items.some(i=>i.id===t.id)&&!(saved.deleted||[]).includes(t.id));
    return [...saved.items.map(item=>({...item,modules:normalizeModules(item.modules,item.moduleVersion)})),...seeds,...(snapshot?.tasks||[]).map(t=>({id:t.id,name:t.name,sourceId:t.id,purpose:t.kind==='coupon'?'召回':'转化提升',builtin:true,...saved.config?.[t.id],moduleVersion:saved.moduleVersions?.[t.id]||1,modules:normalizeModules(saved.modules[t.id],saved.moduleVersions?.[t.id])}))];
  }
  get(user,id,snapshot){return this.list(user,snapshot).find(t=>t.id===id)||null;}
  mutate(user,change){
    const work=this.queue.then(async()=>{
      const next=structuredClone(this.users),saved=next[user]||{items:[],modules:{}};
      const result=change(saved);next[user]=saved;
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const temporary=join(this.directory,'analysis-tasks.next.json');
      await writeFile(temporary,JSON.stringify(next),{mode:0o600});await rename(temporary,join(this.directory,'analysis-tasks.json'));
      this.users=next;return result;
    });
    this.queue=work.catch(()=>{});return work;
  }
  create(user,input,snapshot){
    const name=typeof input.name==='string'?input.name.trim():'';
    if(!name||name.length>80)fail('任务名称需为 1–80 个字符');
    if(!['拉新','召回','促活','转化提升','用户关怀'].includes(input.purpose))fail('请选择任务目的');
    if(!snapshot?.tasks.some(t=>t.id===input.sourceId))fail('请选择已接入的数据源');
    return this.mutate(user,saved=>{
      if(saved.items.length>=100)fail('最多创建 100 个分析任务');
      if(saved.items.some(t=>t.name===name))fail('已有同名任务，请使用其他名称',409);
      const item={id:randomUUID(),name,purpose:input.purpose,sourceId:input.sourceId,modules:[...DEFAULT_MODULES],createdAt:new Date().toISOString()};
      saved.items.unshift(item);return item;
    });
  }
  createAudience(user,parentId,input,snapshot){
    const parent=this.get(user,parentId,snapshot);
    if(!parent||parent.parentId)fail('父任务不存在',404);
    const source=snapshot.tasks.find(t=>t.id===parent.sourceId);
    const config=validateAnalysis(input,source.kind);
    return this.mutate(user,saved=>{
      if(saved.items.length>=100)fail('最多创建 100 个分析任务');
      if(this.list(user,snapshot).some(t=>t.parentId===parentId&&t.name===config.name))fail('当前任务下已有同名人群分析',409);
      const item={id:randomUUID(),parentId,sourceId:parent.sourceId,purpose:parent.purpose,modules:[...DEFAULT_MODULES],...config,createdAt:new Date().toISOString()};
      saved.items.push(item);return item;
    });
  }
  update(user,id,input,snapshot){
    const current=this.get(user,id,snapshot);if(!current)fail('任务不存在',404);
    const patch=Object.hasOwn(input,'modules')?{modules:validateModules(input.modules),moduleVersion:2}:validateAnalysis(input,snapshot.tasks.find(t=>t.id===current.sourceId).kind,{requireCrowd:!!current.parentId});
    return this.mutate(user,saved=>{
      const item=saved.items.find(t=>t.id===id);
      if(item){Object.assign(item,patch,{updatedAt:new Date().toISOString()});return item;}
      if(current.seed){if((saved.deleted||[]).includes(id))fail('分析已删除，请刷新列表',404);const item={...current,...patch,updatedAt:new Date().toISOString()};saved.items.push(item);return item;}
      if(patch.modules){saved.modules[id]=patch.modules;saved.moduleVersions||={};saved.moduleVersions[id]=2;}
      else{saved.config||={};saved.config[id]=patch;}
      return {...current,...patch};
    });
  }
  remove(user,id,snapshot){
    const current=this.get(user,id,snapshot);if(!current?.parentId)fail('人群分析不存在',404);
    return this.mutate(user,saved=>{
      const item=saved.items.find(t=>t.id===id);
      if(!item&&!current.seed)fail('人群分析不存在',404);
      saved.deleted||=[];if(current.seed&&!saved.deleted.includes(id))saved.deleted.push(id);
      saved.items=saved.items.filter(t=>t.id!==id);return {id,parentId:current.parentId};
    });
  }
}

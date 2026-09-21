import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const MODULES=[
  ['preOverview','洞察结论','pre'],['preMetrics','核心指标','pre'],['audienceProfile','基本画像','pre'],['experimentBalance','当前分组画像','pre'],['historyReference','历史活动验证','pre'],
  ['effectOverview','累计结论','monitor'],['effectMetrics','累计指标','monitor'],['resourceFunnelPanel','转化漏斗','monitor'],['effectBreakdown','累计标签拆解','monitor'],['cumulativeCausePanel','未达成画像','monitor'],['subview-movement','分日效果','monitor'],['effectHistoryComparison','历史活动对比','monitor'],
].map(([id,label,phase])=>({id,label,phase}));
const DEFAULT_MODULES=MODULES.map(m=>m.id);
const fail=(message,code=400)=>{throw Object.assign(new Error(message),{code});};
export function validateModules(value){
  if(!Array.isArray(value)||!value.length||value.length>DEFAULT_MODULES.length||value.some(id=>!DEFAULT_MODULES.includes(id))||new Set(value).size!==value.length)fail('至少选择一个有效分析模块');
  return [...value];
}
export class AnalysisTasks {
  constructor(directory){this.directory=directory;this.users={};this.queue=Promise.resolve();}
  async load(){try{this.users=JSON.parse(await readFile(join(this.directory,'analysis-tasks.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  list(user,snapshot){
    const saved=this.users[user]||{items:[],modules:{}};
    return [...saved.items,...(snapshot?.tasks||[]).map(t=>({id:t.id,name:t.name,sourceId:t.id,purpose:t.kind==='coupon'?'召回':'转化提升',builtin:true,modules:saved.modules[t.id]||DEFAULT_MODULES}))];
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
  update(user,id,input,snapshot){
    const modules=validateModules(input.modules);
    return this.mutate(user,saved=>{
      const item=saved.items.find(t=>t.id===id);
      if(item){item.modules=modules;return item;}
      const builtin=snapshot?.tasks.find(t=>t.id===id);if(!builtin)fail('任务不存在',404);
      saved.modules[id]=modules;return {...this.get(user,id,snapshot),modules};
    });
  }
}

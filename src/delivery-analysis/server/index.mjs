import {gzipSync} from 'node:zlib';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Gateway } from './gateway.mjs';
import { SnapshotStore } from './store.mjs';
import {exportReport} from './export-report.mjs';
import {AnalysisTasks,MODULES} from './analysis-tasks.mjs';
import {selectAnalysis} from './analysis-selection.mjs';
import {crowdCatalog,METRICS,OBSERVED} from './analysis-config.mjs';
import { buildSnapshot, selectTask } from './snapshot.mjs';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const files=new Map(['index.html','original-live.js','report-runtime.js','agent-theme.css','report-theme.css','agent-bridge.js','agent-widget.js','agent-widget.css','report-actions.css','report-actions.js'].map(name=>['/'+name,name]));
const mime={html:'text/html; charset=utf-8',js:'application/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
function json(res,status,data) {
  const gzip=(res.req.headers['accept-encoding']||'').split(',').some(part=>{const [name,...params]=part.trim().split(';');const quality=params.find(p=>p.trim().startsWith('q='));return name==='gzip'&&(!quality||Number(quality.trim().slice(2))>0);});
  const body=JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Accept-Encoding',...(gzip?{'Content-Encoding':'gzip'}:{})});
  res.end(gzip?gzipSync(body):body);
}

async function readBody(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>32768)throw Object.assign(new Error('请求过大'),{code:413});chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||Array.isArray(value)||typeof value!=='object')throw new Error();return value;}catch{throw Object.assign(new Error('请求格式无效'),{code:400});}
}

export function createServer({gateway,store,appDirectory=join(ROOT,'app'),tasks}) {
  return http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/healthz')return json(res,200,{ok:true,dataMode:'live',ready:!!store.snapshot,status:store.status});
      if(url.pathname.startsWith('/api/')) {
        let user;
        try {user=await gateway.authenticate(req.headers.authorization);} catch(error) {
          return json(res,[401,403].includes(error.code)?error.code:503,{error:[401,403].includes(error.code)?'请先登录 DiAgent':'登录服务暂不可用'});
        }
        if(!user?.id)return json(res,401,{error:'请先登录 DiAgent'});
        if(url.pathname==='/api/refresh'){
          if(req.method==='POST'){void store.refresh();return json(res,202,{status:store.status});}
          if(req.method==='GET')return json(res,200,{status:store.status,builtAt:store.snapshot?.builtAt});
        }
        if(tasks && url.pathname==='/api/tasks' && req.method==='POST')return json(res,201,{item:await tasks.create(user.id,await readBody(req),store.snapshot)});
        const audiencePath=url.pathname.match(/^\/api\/tasks\/([^/]+)\/audiences$/);
        if(tasks && audiencePath && req.method==='POST')return json(res,201,{item:await tasks.createAudience(user.id,decodeURIComponent(audiencePath[1]),await readBody(req),store.snapshot)});
        if(tasks && /^\/api\/tasks\/[^/]+$/.test(url.pathname) && req.method==='DELETE')return json(res,200,await tasks.remove(user.id,decodeURIComponent(url.pathname.slice(11)),store.snapshot));
        if(url.pathname==='/api/crowds' && req.method==='GET'){
          const query=(url.searchParams.get('q')||'').trim().toLowerCase();
          return json(res,200,{items:crowdCatalog(store.snapshot).filter(c=>!query||c.id.includes(query)||c.name.toLowerCase().includes(query)),note:'已核验的关联包目录；暂未接通 Ditag 全站搜索。可录入其他包 ID 保存待核验关联。'});
        }
        if(tasks && url.pathname.startsWith('/api/tasks/') && req.method==='PATCH')return json(res,200,{item:await tasks.update(user.id,decodeURIComponent(url.pathname.slice(11)),await readBody(req),store.snapshot)});
        if(tasks && url.pathname==='/api/export' && req.method==='POST'){
          const input=await readBody(req);
          const analysisTask=tasks.get(user.id,input.selection?.taskId,store.snapshot);
          if(!analysisTask)return json(res,404,{error:'任务不存在'});
          const html=await exportReport({snapshot:store.snapshot,analysisTask,input,appDirectory});
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Disposition':"attachment; filename=delivery-report.html; filename*=UTF-8''"+encodeURIComponent(analysisTask.name+'.html')});return res.end(html);
        }
        if(req.method!=='GET')return json(res,405,{error:'不支持的操作'});
        if(!['/api/bootstrap','/api/tasks'].includes(url.pathname))return json(res,404,{error:'接口不存在'});
        if(!store.snapshot)return json(res,503,{error:store.status.lastError || '正在准备真实数据，请稍后刷新',status:store.status});
        const snapshot=store.snapshot;
        const sources=snapshot.tasks.map(t=>({id:t.id,name:t.name,kind:t.kind,partition:t.partition}));
        const items=tasks?tasks.list(user.id,snapshot):sources;
        if(url.pathname==='/api/tasks')return json(res,200,{items,sources,modules:MODULES,metrics:METRICS,observedMetrics:OBSERVED});
        const id=url.searchParams.get('taskId') || sources[0].id;
        const analysisTask=tasks?tasks.get(user.id,id,snapshot):null;
        if(tasks&&!analysisTask)return json(res,404,{error:'任务不存在'});
        const sourceId=analysisTask?.sourceId||id;
        let task;
        try {task=selectAnalysis(snapshot,analysisTask||{sourceId},{crowdId:url.searchParams.get('crowdId'),date:url.searchParams.get('date'),group:url.searchParams.get('group')||'all',dimension:url.searchParams.get('dimension')||'charge_life_cycle',portraitDimension:url.searchParams.get('portraitDimension')||undefined,profileDimensions:url.searchParams.get('profileDimensions')||undefined,cumulativeGroup:url.searchParams.get('cumulativeGroup')||'all',cumulativeDimension:url.searchParams.get('cumulativeDimension')||'charge_life_cycle',cumulativeBreakdown:url.searchParams.get('cumulativeBreakdown')||undefined});} catch {
          return json(res,400,{error:'日期、分组或维度不在当前数据范围内'});
        }
        if(!task)return json(res,404,{error:'该任务尚未接入真实数据'});
        return json(res,200,{env:'live',builtAt:snapshot.builtAt,status:store.status,currentUser:{id:user.id,name:user.display_name || user.username},tasks:sources,analysisTask,moduleOptions:MODULES,task});
      }
      if(req.method!=='GET')return json(res,405,{error:'method_not_allowed'});
      const name=url.pathname==='/'?'index.html':files.get(url.pathname);
      if(!name)return json(res,404,{error:'not_found'});
      const body=await readFile(join(appDirectory,name));
      res.writeHead(200,{'Content-Type':mime[name.split('.').at(-1)],'Cache-Control':'no-store'});res.end(body);
    } catch(error) {const code=[400,404,409,413].includes(error.code)?error.code:500;json(res,code,{error:code===500?'服务暂不可用，请稍后重试':error.message});}
  });
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const runtime=process.env.DELIVERY_RUNTIME_DIR || join(ROOT,'runtime');
  const gateway=new Gateway({baseURL:process.env.DI_AGENT_URL || 'http://127.0.0.1:8080',tokenFile:process.env.DI_AGENT_TOKEN_FILE || join(runtime,'service-token')});
  const store=new SnapshotStore(runtime,()=>buildSnapshot(gateway));
  await store.load();
  const tasks=new AnalysisTasks(runtime);await tasks.load();
  createServer({gateway,store,tasks}).listen(Number(process.env.PORT || 4173),process.env.HOST || '127.0.0.1');
  void store.refresh();
  setInterval(()=>void store.refresh(),30*60*1000).unref();
}

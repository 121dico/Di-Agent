import {gzipSync} from 'node:zlib';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Gateway } from './gateway.mjs';
import { SnapshotStore } from './store.mjs';
import { buildSnapshot, selectTask } from './snapshot.mjs';

const ROOT=dirname(dirname(fileURLToPath(import.meta.url)));
const files=new Map(['index.html','original-live.js','report-runtime.js','agent-theme.css','report-theme.css','agent-bridge.js','agent-widget.js','agent-widget.css'].map(name=>['/'+name,name]));
const mime={html:'text/html; charset=utf-8',js:'application/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
function json(res,status,data) {
  const gzip=(res.req.headers['accept-encoding']||'').split(',').some(part=>{const [name,...params]=part.trim().split(';');const quality=params.find(p=>p.trim().startsWith('q='));return name==='gzip'&&(!quality||Number(quality.trim().slice(2))>0);});
  const body=JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Accept-Encoding',...(gzip?{'Content-Encoding':'gzip'}:{})});
  res.end(gzip?gzipSync(body):body);
}

export function createServer({gateway,store,appDirectory=join(ROOT,'app')}) {
  return http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/healthz')return json(res,200,{ok:true,dataMode:'live',ready:!!store.snapshot,status:store.status});
      if(url.pathname.startsWith('/api/')) {
        let user;
        try {user=await gateway.authenticate(req.headers.authorization);} catch(error) {
          return json(res,[401,403].includes(error.code)?error.code:503,{error:[401,403].includes(error.code)?'请先登录 DiAgent':'登录服务暂不可用'});
        }
        if(req.method!=='GET')return json(res,405,{error:'此数据工作台暂仅提供查询，配置功能待接入'});
        if(!['/api/bootstrap','/api/tasks'].includes(url.pathname))return json(res,404,{error:'接口不存在'});
        if(!store.snapshot)return json(res,503,{error:store.status.lastError || '正在准备真实数据，请稍后刷新',status:store.status});
        const snapshot=store.snapshot;
        const tasks=snapshot.tasks.map(t=>({id:t.id,name:t.name,kind:t.kind,partition:t.partition}));
        if(url.pathname==='/api/tasks')return json(res,200,{items:tasks});
        const id=url.searchParams.get('taskId') || tasks[0].id;
        let task;
        try {task=selectTask(snapshot,id,{date:url.searchParams.get('date'),group:url.searchParams.get('group')||'all',dimension:url.searchParams.get('dimension')||'charge_life_cycle',portraitDimension:url.searchParams.get('portraitDimension')||undefined,profileDimensions:url.searchParams.get('profileDimensions')||undefined,cumulativeGroup:url.searchParams.get('cumulativeGroup')||'all',cumulativeDimension:url.searchParams.get('cumulativeDimension')||'charge_life_cycle'});} catch {
          return json(res,400,{error:'日期、分组或维度不在当前数据范围内'});
        }
        if(!task)return json(res,404,{error:'该任务尚未接入真实数据'});
        return json(res,200,{env:'live',builtAt:snapshot.builtAt,status:store.status,currentUser:{id:user.id,name:user.display_name || user.username},tasks,task});
      }
      if(req.method!=='GET')return json(res,405,{error:'method_not_allowed'});
      const name=url.pathname==='/'?'index.html':files.get(url.pathname);
      if(!name)return json(res,404,{error:'not_found'});
      const body=await readFile(join(appDirectory,name));
      res.writeHead(200,{'Content-Type':mime[name.split('.').at(-1)],'Cache-Control':'no-store'});res.end(body);
    } catch {json(res,500,{error:'服务暂不可用，请稍后重试'});}
  });
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const runtime=process.env.DELIVERY_RUNTIME_DIR || join(ROOT,'runtime');
  const gateway=new Gateway({baseURL:process.env.DI_AGENT_URL || 'http://127.0.0.1:8080',tokenFile:process.env.DI_AGENT_TOKEN_FILE || join(runtime,'service-token')});
  const store=new SnapshotStore(runtime,()=>buildSnapshot(gateway));
  await store.load();
  createServer({gateway,store}).listen(Number(process.env.PORT || 4173),process.env.HOST || '127.0.0.1');
  void store.refresh();
  setInterval(()=>void store.refresh(),30*60*1000).unref();
}

import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {selectAnalysis} from './analysis-selection.mjs';
import {MODULES} from './analysis-tasks.mjs';
const jsonScript=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const inlineScript=source=>'<script>'+source.replace(/<\/script/gi,'<\\/script')+'</script>';
export async function exportReport({snapshot,analysisTask,input,appDirectory}){
  if(!snapshot)throw Object.assign(new Error('真实数据尚未就绪'),{code:409});
  if(input.builtAt!==snapshot.builtAt)throw Object.assign(new Error('服务器快照已更新，请重新加载后导出'),{code:409});
  const selection=input.selection||{};
  let selected;try{selected=selectAnalysis(snapshot,analysisTask,selection);}catch{throw Object.assign(new Error('日期、分组或维度不在当前数据范围内'),{code:400});}
  if(selected?.scopeUnavailable)throw Object.assign(new Error(selected.scopeUnavailable),{code:409});
  if(!selected)throw Object.assign(new Error('任务数据尚未就绪'),{code:409});
  // 只包含当前任务聚合与查询依据，不序列化服务对象、用户身份或其它任务。
  const task=snapshot.tasks.find(t=>t.id===analysisTask.sourceId);
  const frozen={version:snapshot.version,builtAt:snapshot.builtAt,fieldCoverage:snapshot.fieldCoverage,tasks:[task],queries:selected.evidence};
  const data={snapshot:frozen,analysisTask,selection:{...selection,taskId:analysisTask.id},modules:MODULES,view:input.view||{},exportedAt:new Date().toISOString()};
  let html=await readFile(join(appDirectory,'index.html'),'utf8');
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  html=html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/gi,'');
  const styles=await Promise.all(['report-theme.css','report-actions.css'].map(name=>readFile(join(appDirectory,name),'utf8')));
  html=html.replace('</head>','<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'"><style>'+styles.join('\n')+'</style></head>');
  html=html.replace(/<title>[^<]*<\/title>/i,'<title>投放分析 · 离线交互报告</title>');
  const scripts=await Promise.all(['offline-model.js','report-runtime.js','original-live.js','report-actions.js'].map(name=>readFile(join(appDirectory,name),'utf8')));
  return html.replace('</body>','<script type="application/json" id="deliverySnapshot">'+jsonScript(data)+'</script>'+scripts.map(inlineScript).join('\n')+'</body>');
}

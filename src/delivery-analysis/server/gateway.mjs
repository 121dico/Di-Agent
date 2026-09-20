import { readFile } from 'node:fs/promises';

export class Gateway {
  constructor({baseURL,tokenFile,fetcher=fetch}) {
    this.baseURL=baseURL;this.tokenFile=tokenFile;this.fetcher=fetcher;this.evidence=[];
  }
  async request(path,body,authorization) {
    const response=await this.fetcher(this.baseURL+path,{
      method:body===undefined?'GET':'POST',
      headers:{Authorization:authorization,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000),
    });
    if(!response.ok) {const error=new Error('gateway request failed');error.code=response.status;throw error;}
    const value=await response.json();
    if(value.code!==0) throw new Error('gateway business error');
    return value.data;
  }
  async authenticate(authorization) {
    if(!authorization?.startsWith('Bearer ')) {const error=new Error('unauthorized');error.code=401;throw error;}
    return this.request('/api/users/me',undefined,authorization);
  }
  async service(path,body) {
    const token=(await readFile(this.tokenFile,'utf8')).trim();
    if(!token) throw new Error('service credential missing');
    return this.request(path,body,'Bearer '+token);
  }
  contracts() {return this.service('/mcp/report-data/contracts');}
  async query(query) {
    const fetchPage=async(page)=>{
      const result=await this.service('/mcp/report-data/query',{...query,page,page_size:100});
      if(!Array.isArray(result.rows)) throw new Error('invalid upstream rows');
      if(result.query_id) this.evidence.push({queryId:result.query_id,sourceId:query.source_id,page,durationMs:result.duration_ms,query});
      return result;
    };
    const validateRows=(rows,total)=>{
      if(!Number.isInteger(total) || total<0 || rows.length!==total)throw new Error('incomplete aggregate');
      const keys=new Set(rows.map(r=>JSON.stringify((query.group_by||[]).map(name=>r[name]))));
      if(keys.size!==rows.length)throw new Error('duplicate aggregate page');
      return rows;
    };
    const first=await fetchPage(1);
    const pages=Number(first.pagination?.page_count || 1);
    if(!Number.isInteger(pages) || pages<1 || pages>300) throw new Error('aggregate result exceeds bound');
    if(pages<=1)return validateRows(first.rows,Number(first.pagination?.total));
    const fixed=new Set((query.filters||[]).filter(f=>f.operator==='EQ'||f.operator==='IS_NULL').map(f=>f.name));
    const free=(query.group_by||[]).filter(name=>!fixed.has(name));
    // 网关仅支持单字段排序；多列分组分页必须先按分组键拆分，避免同排序值翻页丢失或重复。
    if(free.length>1) {
      const split=free[0];
      const keys=await this.query({source_id:query.source_id,fields:[{name:split}],filters:query.filters,group_by:[split],order_by:split});
      const rows=[];
      for(const key of keys) {
        const condition=key[split]==null?{name:split,operator:'IS_NULL'}:{name:split,operator:'EQ',value:key[split]};
        rows.push(...await this.query({...query,filters:[...(query.filters||[]),condition],order_by:free[1]}));
      }
      return validateRows(rows,Number(first.pagination.total));
    }
    const rows=[...first.rows];
    for(let page=2;page<=pages;page++) {
      const result=await fetchPage(page);
      if(result.pagination?.total!==first.pagination?.total)throw new Error('aggregate pagination changed');
      rows.push(...result.rows);
    }
    return validateRows(rows,Number(first.pagination.total));
  }
}

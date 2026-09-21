import test from 'node:test';
import assert from 'node:assert/strict';
import {Gateway} from '../server/gateway.mjs';
const query={source_id:'source',fields:[{name:'dt'}],group_by:['dt'],order_by:'dt'};
function gatewayWith(result){const g=new Gateway({baseURL:'http://localhost',tokenFile:''});g.service=async()=>result;return g;}
test('单页少行或重复分组不能作为完整快照输入',async()=>{
 await assert.rejects(()=>gatewayWith({rows:[{dt:'2026-09-19'}],pagination:{total:2,page_count:1}}).query(query));
 await assert.rejects(()=>gatewayWith({rows:[{dt:'2026-09-19'},{dt:'2026-09-19'}],pagination:{total:2,page_count:1}}).query(query));
});
test('完整单页和空结果保留其真实语义',async()=>{
 assert.deepEqual(await gatewayWith({rows:[],pagination:{total:0,page_count:0}}).query(query),[]);
 assert.deepEqual(await gatewayWith({rows:[{dt:'2026-09-19'}],pagination:{total:1,page_count:1}}).query(query),[{dt:'2026-09-19'}]);
});
test('只读聚合遇到瞬时连接错误重试，鉴权失败立即停止',async()=>{
 let calls=0;
 const gateway=new Gateway({baseURL:'http://localhost',tokenFile:'',fetcher:async()=>{calls++;if(calls===1)throw new TypeError('fetch failed');return {ok:true,json:async()=>({code:0,data:{value:12}})};}});
 assert.deepEqual(await gateway.request('/mcp/report-data/query',{},'Bearer test'),{value:12});assert.equal(calls,2);
 let denied=0;gateway.fetcher=async()=>{denied++;return {ok:false,status:403};};
 await assert.rejects(()=>gateway.request('/mcp/report-data/query',{},'Bearer test'));assert.equal(denied,1);
});

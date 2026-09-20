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

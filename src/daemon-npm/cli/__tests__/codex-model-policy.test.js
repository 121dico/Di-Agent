'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveModelPolicy,isModelRejection}=require('../codex-model-policy');
const models=[{id:'local',is_default:true,reasoning_efforts:['low','ultra'],default_reasoning_effort:'low',supports_priority:false}];
test('resolves default or stale models before execution without expanding approval rights',()=>{
 for(const model of ['']){
 const resolved=resolveModelPolicy({model,reasoning_effort:'medium',service_tier:'priority',approval_mode:'request'},models,'local');
 assert.deepEqual(resolved.config,{model:'local',reasoning_effort:'low',service_tier:'default',approval_mode:'request'});
 }
});
test('only explicit model rejection before any turn can trigger recovery',()=>{
 assert.equal(isModelRejection({error:{message:'model is not supported'}}),true);
 for(const response of [{error:{message:'model timeout'}},{error:{message:'quota model unavailable'}},{error:{message:'connection failed'}},{result:{turn:{id:'already-started'}},error:{message:'model is not supported'}}]) assert.equal(isModelRejection(response),false);
});

test('Default preserves a configured private model missing from the menu and never guesses first row',()=>{
 const config={model:'',reasoning_effort:'medium',service_tier:'default',approval_mode:'request'};
 const catalog=[{id:'menu-first',is_default:false,reasoning_efforts:[],supports_priority:false}];
 assert.equal(resolveModelPolicy(config,catalog,'configured-private-model').config.model,'configured-private-model');
 assert.equal(resolveModelPolicy(config,catalog,'').config.model,'');
});

test('a nonlisted explicit model is not silently changed without native rejection',()=>{
 const config={model:'retired',reasoning_effort:'medium',service_tier:'default',approval_mode:'request'};
 assert.equal(resolveModelPolicy(config,models,'local').config.model,'retired');
 assert.equal(resolveModelPolicy(config,models,'local',true).config.model,'local');
});

test('recovery prefers configured default and never retries the already rejected model',()=>{
 const config={model:'retired',reasoning_effort:'medium',service_tier:'default',approval_mode:'request'};
 assert.equal(resolveModelPolicy(config,models,'private-default',true,'retired').config.model,'private-default');
 assert.equal(resolveModelPolicy(config,models,'private-default',true,'private-default').config.model,'local');
});

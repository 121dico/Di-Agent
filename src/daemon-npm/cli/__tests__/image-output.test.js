'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {collectImageOutputs}=require('../image-output');
test('per-turn output directory survives system context splitting on reused persistent slots',()=>{
 const {buildPromptParts}=require('../../bin/di-agent-daemon');
 const {imageOutputInstruction}=require('../image-output');
 for(const dir of ['/tmp/task-first/image-outputs','/tmp/task-next/image-outputs']){
  const parts=buildPromptParts({prompt:'return image'+imageOutputInstruction(dir),context_messages:'[系统指令]\nBe helpful'});
  assert.ok(parts.userPrompt.includes(dir));
  assert.ok(!parts.systemPrompt.includes(dir));
 }
});
test('explicit image reply sends original raster bytes, not machine-local URL',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'di-image-output-test-'));
 try {
  const file=path.join(root,'result.png');const data=Buffer.from('89504e470d0a1a0a','hex');fs.writeFileSync(file,data);
  const result=collectImageOutputs(`Here: ![diagram](<${file}>)`,root);
  assert.equal(result.artifacts.length,1);
  assert.equal(result.artifacts[0].content,`data:image/png;base64,${data.toString('base64')}`);
  assert.ok(!result.text.includes(file));
  assert.match(collectImageOutputs('![x](../secret.png)',root).text,/图片未返回.*输出目录/);
  assert.equal(collectImageOutputs('![x](https://example.com/x.png)',root).artifacts.length,0);
  fs.writeFileSync(path.join(root,'fake.png'),'secret credential');
  assert.match(collectImageOutputs('answer\n![x](fake.png)',root).text,/answer\n.*图片格式/);
  assert.equal(collectImageOutputs('```md\n![x](fake.png)\n```',root).artifacts.length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('image output rejects symlink escapes, too many or oversized files and keeps valid text',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'di-image-output-limits-'));
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'di-image-output-outside-'));
 try{
  const bytes=Buffer.from('89504e470d0a1a0a','hex');fs.writeFileSync(path.join(outside,'private.png'),bytes);
  fs.symlinkSync(path.join(outside,'private.png'),path.join(root,'link.png'));
  const escaped=collectImageOutputs('answer\n![x](link.png)',root);
  assert.equal(escaped.artifacts.length,0);assert.match(escaped.text,/answer\n.*输出目录/);
  fs.writeFileSync(path.join(root,'large.png'),Buffer.alloc(4*1024*1024+1));
  assert.match(collectImageOutputs('![x](large.png)',root).text,/4 MiB/);
  const refs=[];for(let i=0;i<5;i++){fs.writeFileSync(path.join(root,`${i}.png`),bytes);refs.push(`![${i}](${i}.png)`);}
  const capped=collectImageOutputs(refs.join('\n'),root);assert.equal(capped.artifacts.length,4);assert.match(capped.text,/最多返回 4/);
  assert.equal(collectImageOutputs('![a](0.png) ![b](0.png)',root).artifacts.length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});

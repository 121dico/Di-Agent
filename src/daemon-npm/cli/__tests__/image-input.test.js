'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateImages,codexImageInput,claudeImageInput}=require('../image-input');
const image={mime_type:'image/png',data:Buffer.from('fixture').toString('base64')};
test('image input validates bounded bytes and rejects unsupported agents instead of text fallback',()=>{
 assert.throws(()=>validateImages([image],'opencode'),/暂不支持/);
 assert.throws(()=>validateImages(Array(5).fill(image),'codex'),/4/);
 assert.throws(()=>validateImages([{...image,data:Buffer.alloc(4*1024*1024+1).toString('base64')}],'codex'),/4 MiB/);
 assert.throws(()=>validateImages([{...image,data:'https://evil/image.png'}],'codex'));
 assert.throws(()=>validateImages([{...image,mime_type:'image/svg+xml'}],'codex'));
 assert.deepEqual(codexImageInput('text',[]),[{type:'text',text:'text'}]);
 assert.deepEqual(claudeImageInput('text',[image])[1],{type:'image',source:{type:'base64',media_type:'image/png',data:image.data}});
});

'use strict';
const fs = require('node:fs');
const path = require('node:path');

// 只收集回复中显式标记、位于本次任务输出目录内的图片；不扫描目录、不访问网络。
function collectImageOutputs(text, outputDir) {
  if (fs.lstatSync(outputDir).isSymbolicLink()) return {text:`${text}\n\n图片未返回：输出目录不能是符号链接`,artifacts:[]};
  const root = fs.realpathSync(outputDir);
  const artifacts = [];
  const seen = new Map();
  let remaining = 4 * 1024 * 1024;
  let fence = null;
  const rewritten = String(text || '').split('\n').map(line => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence=marker[1]; else if(marker[1][0]===fence[0] && marker[1].length>=fence.length) fence=null; return line; }
    if (fence) return line;
    return line.replace(/!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))\s*\)/g, (match, alt, enclosed, raw) => {
    try {
    const reference = (enclosed || raw).replace(/^sandbox:/,'');
    if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith('//')) return match;
    const candidate = path.resolve(root,reference);
    if (!path.isAbsolute(reference) && (reference === '..' || reference.startsWith('../') || reference.startsWith('..\\'))) throw new Error('返回图片必须位于本次任务输出目录内');
    let file;
    try { file = fs.realpathSync(candidate); } catch { throw new Error('返回图片无法读取，请确认图片已保存到本次任务输出目录'); }
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('返回图片必须位于本次任务输出目录内');
    if (seen.has(file)) return `（图片：${seen.get(file)}）`;
    if (artifacts.length >= 4) throw new Error('一次最多返回 4 张图片');
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > remaining) throw new Error('返回图片总大小不能超过 4 MiB');
    const data = fs.readFileSync(file);
    remaining -= data.length;
    if (remaining < 0) throw new Error('返回图片总大小不能超过 4 MiB');
    let mime;
    if (data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) mime='image/png';
    else if (data[0]===0xff && data[1]===0xd8 && data[2]===0xff) mime='image/jpeg';
    else if (/^GIF8[79]a/.test(data.subarray(0,6).toString())) mime='image/gif';
    else if (data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WEBP') mime='image/webp';
    if (!mime) throw new Error('返回图片格式无效，仅支持 PNG/JPEG/GIF/WebP');
    const filename = path.basename(file);
    seen.set(file, filename);
    artifacts.push({type:'image',filename,title:alt || filename,content:`data:${mime};base64,${data.toString('base64')}`});
    return `（图片：${filename}）`;
    } catch (error) { return `（图片未返回：${error.message}）`; }
    });
  }).join('\n');
  return {text:rewritten,artifacts};
}

function imageOutputInstruction(outputDir) {
  return `\n[图片返回协议]\n需要给用户返回图片时，将 PNG/JPEG/GIF/WebP 文件保存到本次任务专属目录 ${outputDir}，在最终回复中使用 ![说明](<绝对路径>) 引用。系统会上传并展示图片。只返回本次用户请求授权的图片；不要引用私密文件或输出目录外的文件。最多 4 张、总大小 4 MiB。\n`;
}
module.exports = {collectImageOutputs,imageOutputInstruction};

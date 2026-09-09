'use strict';

function validateImages(images, cliTool) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > 4) throw new Error('Agent 每条消息最多支持 4 张图片');
  if (images.length && !['codex', 'claude'].includes(cliTool)) throw new Error(`当前 ${cliTool} Agent 暂不支持原生图片输入，请选择 Codex 或 Claude`);
  let bytes = 0;
  return images.map(image => {
    if (!image || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.mime_type) || typeof image.data !== 'string' || !image.data.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) throw new Error('Invalid Agent image input');
    if (image.data.length > Math.ceil(4 * 1024 * 1024 / 3) * 4) throw new Error('Agent 图片总大小不能超过 4 MiB');
    const data = Buffer.from(image.data, 'base64');
    bytes += data.length;
    if (data.toString('base64') !== image.data || bytes > 4 * 1024 * 1024) throw new Error('Agent 图片总大小不能超过 4 MiB');
    return image;
  });
}
function codexImageInput(text, images) {
  return [{type:'text', text}, ...validateImages(images,'codex').map(i => ({type:'image',url:`data:${i.mime_type};base64,${i.data}`}))];
}
function claudeImageInput(text, images) {
  return [{type:'text', text}, ...validateImages(images,'claude').map(i => ({type:'image', source:{type:'base64',media_type:i.mime_type,data:i.data}}))];
}
module.exports = {validateImages,codexImageInput,claudeImageInput};

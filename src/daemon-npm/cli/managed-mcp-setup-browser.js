'use strict';
(() => {
  const parts = location.hash.slice(1).split('.');
  history.replaceState(null, '', '/setup');
  const token = parts[0] || ''; const csrf = parts[1] || '';
  const $ = (id) => document.getElementById(id);
  let pending = false; let locked = false; let expired = false; let edited = false; let storageSupported = false;
  const labels = { daemon: '本机连接程序', proxy: '安全助手本地代理', identity: '身份与 MCP 握手', credential: '个人 API Key', project: '项目权限' };
  const descriptions = { daemon_ready: '已连接', proxy_reachable: '可达 · 不代表已登录', proxy_unreachable: '无法连接，请启动安全助手', identity_verified: '真实握手通过', identity_required: '尚未验证，请核对登录与新版 Key', mcp_failed: '握手失败，请核对 Key、登录与项目', key_present: '本机已配置 · 不代表有效', key_missing: '尚未配置', project_unverified: '待真实数据调用验证', configuration_changed: '配置已变更，请重新检测', timeout: '检测超时，请稍后重试' };
  const errors = { request_denied: '此电脑授权不可用，请确认本人登录并从 Di Agent 重新打开。', session_expired: '配置页已失效，请回到 Di Agent 重新打开。', busy: '另一个检测或保存正在进行，请稍后重试。', invalid_input: '请检查 API Key 和项目 Code 的格式。', body_too_large: '输入过长，请重新复制 API Key 和项目 Code。', configure_failed: '保存或读取失败。请核对 Key 格式、项目 Code、钥匙串访问权限；Windows 暂只支持个人进程环境配置。' };
  function feedback(message, error = false) { $('feedback').textContent = message; $('feedback').classList.toggle('error', error); }
  function controls() { $('save').disabled = pending || locked || expired || !storageSupported; $('inspect').disabled = pending || expired || edited; $('api-key').disabled = locked || expired || pending || !storageSupported; $('project-code').disabled = locked || expired || pending || !storageSupported; }
  async function api(route, body = {}) {
    const response = await fetch(route, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-DiAgent-Session': token, 'X-CSRF-Token': csrf }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { if (response.status === 410 || response.status === 403) expired = true; throw new Error(errors[result.error] || '操作失败，请重新打开配置页后再试。'); }
    return result;
  }
  function render(result, populate = false) {
    $('checks').replaceChildren();
    for (const check of result.checks || []) {
      const row = document.createElement('li'); const name = document.createElement('span'); const value = document.createElement('span');
      name.textContent = labels[check.id] || check.id; value.textContent = check.status === 'unverified' && check.id === 'proxy' ? '尚未检测' : descriptions[check.code] || '尚未验证';
      value.className = `checkValue ${check.status}`; row.append(name, value); $('checks').append(row);
    }
    $('checked-at').textContent = result.status === 'connected' || result.status === 'failed' ? new Date(result.checked_at).toLocaleTimeString() : '配置状态 · 尚未验证';
    $('key-hint').textContent = result.key_configured ? '（已保存，留空保留）' : '（必填）';
    locked = result.credential_source === 'environment' || result.project_source === 'environment';
    $('source-notice').hidden = !locked;
    $('source-notice').textContent = '当前配置来自 daemon 进程环境变量，本页面不会覆盖。请修改启动环境，等待任务结束后安全重启连接程序，再检测。';
    if (populate) $('project-code').value = result.project_code || '';
    $('key-guide').open = !result.key_configured;
    $('project-guide').open = !result.project_code || result.project_source === 'default';
    $('identity-guide').open = result.checks?.some((check) => ['identity', 'proxy'].includes(check.id) && check.status === 'failed') || false;
    controls();
  }
  async function run(action) {
    if (pending || expired) return;
    pending = true; controls(); feedback('正在处理，请稍候…');
    try { await action(); } catch (error) { feedback(error.message || '连接中断，请从 Di Agent 重新打开配置页。', true); }
    finally { pending = false; controls(); }
  }
  $('configuration').addEventListener('input', () => {
    edited = true; $('checked-at').textContent = '输入已修改 · 保存后重新检测';
    const identity = $('checks').children[2]?.lastElementChild;
    if (identity) { identity.textContent = '输入已修改 · 旧验证不适用'; identity.className = 'checkValue unverified'; }
    controls(); feedback('尚未保存。请先保存配置，再检测真实连接。');
  });
  $('configuration').addEventListener('submit', (event) => {
    event.preventDefault();
    run(async () => {
      const result = await api('/save', { key: $('api-key').value, project: $('project-code').value.trim() });
      $('api-key').value = ''; edited = false; render(result, true); feedback('已保存到本机，尚未验证连接。点击「检测连接」继续。');
    });
  });
  $('inspect').addEventListener('click', () => run(async () => {
    const result = await api('/inspect'); render(result);
    feedback(result.status === 'connected' ? 'MCP 真实连接通过。项目、表和 SQL 权限将在实际调用时分别验证。返回 Di Agent 后请刷新连接状态。' : '检测未全部通过，请按上方具体状态处理后重试。', result.status !== 'connected');
  }));
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(csrf)) { expired = true; controls(); feedback(errors.session_expired, true); $('checks').textContent = '未读取个人配置'; }
  else run(async () => {
    const response = await fetch('/capabilities', { credentials: 'omit', cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('配置页已失效，请从 Di Agent 重新打开。');
    storageSupported = (await response.json()).storage_supported === true;
    $('configuration').prepend($('storage-notice'));
    $('storage-notice').hidden = storageSupported;
    render(await api('/state'), true);
    feedback(storageSupported ? '本页只保存个人配置；点击「检测连接」验证真实通道。' : '本机仅支持检测，不支持页面保存。请先按下方 Windows 环境变量说明配置后重启连接程序。');
  });
})();

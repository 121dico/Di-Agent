'use strict';

// ZcodeCliSpec: ZCode 桌面端底座（variant: 'desktop'）。
//
// ZCode 目前没有可 headless 调用的 CLI 二进制（App 内部的 zcode-cli 运行时
// 不是公开入口），因此该底座：
// - 扫描：通过检测 App 安装路径判定"已安装"，注册为候选底座（variant=desktop）；
// - 执行：buildCommand 返回 error 标记，executeTask 前置拦截并向用户返回
//   明确提示（而不是 spawn 失败的晦涩 ENOENT）。
// 未来 ZCode 发布官方 CLI 后，补全 buildCommand/parseStreamEvent 即可无缝接入，
// 主流程零修改（见 registry.js 的 spec 契约）。

const DARWIN_APP_PATHS = ['/Applications/ZCode.app', `${process.env.HOME || ''}/Applications/ZCode.app`];

function windowsAppPaths() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];
  const { join } = require('path');
  return [join(localAppData, 'Programs', 'ZCode', 'ZCode.exe')];
}

function zcodeAppInstalled() {
  const { existsSync } = require('fs');
  const paths = process.platform === 'win32' ? windowsAppPaths() : DARWIN_APP_PATHS;
  return paths.some((candidate) => candidate && existsSync(candidate));
}

function createZcodeCliSpec(ctx) {
  return {
    cliTool: 'zcode',
    // UI 名（CANDIDATES 派生时使用）。
    name: 'ZCode',
    // 底座类型标注：desktop = 桌面端应用（无 headless CLI），cli = 终端命令行。
    variant: 'desktop',
    // 默认能力（capabilities），skill 扫描无结果时回退。
    defaultCapabilities: ctx.defaultSkills(['coding', 'review', 'orchestration']),

    // 桌面端存在性检查：App 已安装即视为可用底座（版本号统一标 desktop）。
    desktopAppInstalled: zcodeAppInstalled,

    resolveCommand(_taskOrCtx) {
      return 'zcode';
    },

    // 桌面端底座不支持自动执行：返回 error 标记，executeTask 拦截后作为任务
    // 结果回传给用户（前端能直接看到原因）。
    buildCommand(task) {
      return {
        error: `ZCode 是桌面端（Desktop）底座，暂不支持自动执行任务。请在 Agent 设置中选择 CLI 底座（claude / codex / opencode 等）。`,
      };
    },

    skillRoots(cwd, home) {
      const roots = [];
      const includeProjectRoots = !ctx.isDiAgentWorkspace(cwd);
      if (includeProjectRoots) ctx.addRoot(roots, ctx.pathJoin(cwd, '.zcode', 'skills'));
      if (home) ctx.addRoot(roots, ctx.pathJoin(home, '.zcode', 'skills'));
      return roots;
    },

    installSkillRoot(home) {
      return ctx.pathJoin(home, '.zcode', 'skills');
    },

    // one-shot 模式占位：桌面端不会真正走 parseResult。
    parseResult() {
      return '(ZCode 桌面端底座不支持自动执行)';
    },
    parseStreamEvent(_line, _ctx) { return null; },
    parseStreamEventAll(_line, _ctx) { return []; },
  };
}

module.exports = { createZcodeCliSpec };

# 深色消息选区修复发布

- 版本：`dark-selection-20261020T034753Z`，基线 `recipient-above-20261020T033215Z`，2026-10-20。
- 范围：仅 MessageBubble 深色消息自身/后代/发送中的 `::selection` 与新增回归测试。选区使用 `#335d87` 蓝底、白字；全局浅色选区和布局未改。工作树发布，无 Git 提交或推送。
- 原因：后加载的全局 `::selection` 使用深色文字与半透明蓝色背景，落到深色气泡上对比度不足。
- 按 diagnosing-bugs 先复现并建立失败回归；按 myuiskill 的客观可读性缺陷流程做局部修复和真实拖选验收，没有新增布局/交互。

## 验证

- 修复前新增回归 5 失败、1 通过；修复后 6 通过。消息相关 4 组共 59 测试通过。
- 独立 Standards/Spec review：两轴均无阻断项。
- TypeScript 与 Vite 生产构建通过，保留既有大包警告。
- 完整前端：577 通过、2 失败。失败为既有 `SkillsView.test.tsx` 的 Router 测试环境缺失及 `reportV12Presentation.test.ts` 的 NaN 断言；均在未改动的冻结基线复现，不宣称全绿，不顺带修改。
- 初次快照遗漏前端 config 目录，按冻结哈希验证后补回；依赖使用上一线上候选的相同锁文件依赖树。移除候选中的 AppleDouble 元数据；最终完整测试显式限定 src，避免 Vitest 误收集 Playwright/Electron 测试。
- Edge 单独标签页打开线上，真实拖选原截图同类黑底消息，确认蓝底白字清晰；拖选浅色回复，确认淡蓝底深色字不变。没有发送新消息或停止任务。代码块自身样式未修改；没有单独完成代码块拖选验收。
- 发布后数据库/Redis ready；后端 PID 和二进制不变；鉴权策略、资源计数不变；45 个头像及 105 个源码/资源指纹验证通过。旧哈希资源保留。

## 回滚与留存

- 完整应用与验证过的数据库备份：`/root/energy_tag_agent/.release-backups/dark-selection-20261020T034753Z`。
- 发布清单、验证和逐文件旧版本：`/root/energy_tag_agent/.releases/dark-selection-20261020T034753Z`。
- 前端入口 SHA256：`0c9cd0cab54662a104b876e8cb052763753e00ff05292771d98b2a07704e2792`。
- 回滚应仅恢复该发布的 previous-files 源码/入口/版本记录，不覆盖数据库或运行配置。

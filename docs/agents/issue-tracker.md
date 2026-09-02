# Issue tracker: GitHub

本仓库的 Issues 和 PRD 使用 GitHub Issues 管理，目标仓库为
`121dico/Di-Agent`，所有操作使用 `gh` CLI。

## 常用操作

- 创建：`gh issue create --title "..." --body "..."`
- 查看：`gh issue view <number> --comments`
- 列表：`gh issue list --state open`
- 评论：`gh issue comment <number> --body "..."`
- 标签：`gh issue edit <number> --add-label "..."`
- 关闭：`gh issue close <number> --comment "..."`

## Pull Requests

PR 不作为默认需求或 triage 入口。外部 PR 不自动进入 issue triage 流程。

## 技能约定

- “发布到 issue tracker”表示创建 GitHub Issue。
- “读取相关 ticket”表示通过 `gh issue view` 获取 Issue 正文、标签和评论。
- `/wayfinder` 使用一个 GitHub Issue 作为主地图，子 Issue 表示决策任务；
  优先使用 GitHub 原生 sub-issue 和 dependency，无法使用时退回任务列表与
  `Blocked by: #<number>` 文本约定。

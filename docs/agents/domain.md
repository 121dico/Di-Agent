# Domain Docs

本仓库采用 multi-context 领域文档布局。

## 阅读规则

开始探索代码前：

1. 读取根目录 `CONTEXT-MAP.md`。
2. 根据任务读取相关模块的 `CONTEXT.md`。
3. 检查 `docs/adr/` 中的系统级决策。
4. 检查对应模块 `docs/adr/` 中的模块级决策。

文件不存在时继续工作，不要求提前创建；领域建模流程会在真正需要时补充。

## 布局

```text
/
├── CONTEXT-MAP.md
├── docs/adr/
└── src/
    ├── backend/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    ├── frontend/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    ├── daemon/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    └── daemon-npm/
        ├── CONTEXT.md
        └── docs/adr/
```

## 约定

输出、测试和 Issue 使用各 `CONTEXT.md` 定义的领域词汇。需要违反已有 ADR
时，必须明确指出冲突及重新考虑该决策的原因。

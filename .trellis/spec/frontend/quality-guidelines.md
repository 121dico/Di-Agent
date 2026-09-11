# Frontend Quality Guidelines

> 前端开发硬性规则与禁止模式。

---

## 硬性规则

### 类型安全
- **禁止使用 `any`**，用 `unknown` 或具体类型替代

### API 调用
- 所有 REST 请求通过 `api/` 模块发出，组件内**禁止直接调用** `fetch`/`axios`

### Server State Mutation
- 保存配置类数据（例如 Agent 工具分配）后，store 必须用后端返回值或随后一次权威刷新结果更新本地状态
- 可能与列表查询并发的 mutation 必须防止旧列表响应覆盖新状态（例如使用 mutation version / request epoch）
- 表单保存成功后应从保存接口返回的实体重新解析并回填当前表单状态，避免用户切换页面后才看到后端规范化结果

### WebSocket
- WebSocket 通过自定义 Hook 消费，**不直接操作** WebSocket 实例

### 样式
- 样式使用 **CSS Modules**，类名 **camelCase**
- **禁止内联样式**

### 报表估计线与真实读数

- 正常观测平滑连接；跨已标记离群日的估计段必须以虚线标识，不能跨真实缺失或日历缺口。估计坐标不得写回原始快照或 tooltip。
- 非负幅度图需要保留真实负号提示及下降标记；异常截断柱必须显式断轴并提供原始数值。
- 坐标轴在空系列、全 NaN、全图例关闭时使用有限范围（例如 0..1），不能把无上界约束 Infinity 当作空态绘图区。
- 组件回归覆盖原始负值、离群标记、线性柱比例、缺失断点和空态无 NaN 刻度。

### 受限高度布局
- 在固定高度或 `overflow: hidden` 面板内使用纵向 flex 分区时，必须明确哪个容器负责滚动
- 可展开分区如果需要保持上下文档流顺序，设置 `flex: 0 0 auto`，并在分区或内部列表上设置 `overflow`
- 避免让被 flex 压缩的 section 继续绘制外溢内容，否则展开第二个分区时可能覆盖第一个分区

### Required Tests
- 配置保存类 store 需要覆盖 stale fetch 场景：先发起旧列表请求，再保存配置，最后旧请求返回时不得覆盖保存后的字段

### 内网 HTTP 剪贴板兼容

- 局域网 IP 的 HTTP 页面不是安全上下文，复制功能不能只依赖 `navigator.clipboard.writeText`。
- 共享复制工具的降级路径必须在同步 `document.execCommand('copy')` 期间监听 `copy` 事件，通过 `clipboardData.setData('text/plain', text)` 显式写入完整文本并调用 `preventDefault()`；隐藏 textarea 选区只作为兼容兜底。
- 无论 `execCommand` 返回 `false` 还是抛错，都必须移除临时监听器和 textarea、清理选区并恢复焦点；失败时向调用方抛出可展示的错误。
- 回归测试至少覆盖：原生 Clipboard API 成功、原生 API 拒绝后降级、旧式复制的完整事件载荷、连续两次旧式复制失败后的清理。

```ts
const handleCopy = (event: ClipboardEvent) => {
  if (!event.clipboardData) return;
  event.clipboardData.setData('text/plain', text);
  event.preventDefault();
};
```

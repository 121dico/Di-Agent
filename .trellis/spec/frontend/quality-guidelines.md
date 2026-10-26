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

### Cohort percentage denominators
- Keep within-cohort share separate from same-grade share: `selectedGradeCount / selectedTotal` versus `selectedGradeCount / allOrdersGradeCount`.
- The latter denominator must come from `order-cohort?orders=all` for the same report, snapshot and cities, never the registered-population comparison chart. Hide/show of a legend must not change either denominator.
- Unknown, failed or zero denominators render an unavailable marker, not a fabricated zero percentage. Scope changes must invalidate numerator and denominator together; cover delayed old responses and baseline-only retry through the public component seam.

### 内网 HTTP 剪贴板兼容

- 局域网 IP 的 HTTP 页面不是安全上下文，复制功能不能只依赖 `navigator.clipboard.writeText`。
- 深色消息表面须显式覆盖自身及后代的 `::selection` 前景和背景；不能继承浅色页面的深色选区文字。选区须保持至少 4.5:1 对比度（包含发送中透明度），不修改浅色全局选区；静态 CSS 合同之外需真实浏览器拖选验收。
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

### 报表总览密度与口径

- 总览复用当前 analytics 快照，不为每张指标卡单独请求。缺失显示 `—`，已赋分人数明确为零时等级人数也是零；零分母的占比仍不可用。
- 均分优先使用同日 `nullable_scores`；画像订单计数汇总不得标成当日新增订单，增长须注明快照差口径。
- V1.2 地图筛选常驻展开，限制地图高度并提供完整比例；城市选择不能残留对应全省条件。指标卡按容器宽度降为两列/一列。
- 筛选自动应用按内容去重，避免重置后延迟回调重复查询。日期目录不带城市条件；各日统计和缓存必须保留城市范围，不能以全国统计代替城市数据。

### 环形图与鼠标焦点

- 环形图扇区使用共享 `buildDonutArcPath(start, end)` 的连续圆弧，start/end 为累计人数占总人数的圈数；避免整圆 dash 在缩放时将微小末段绘制成碎片。整圆用两段半圆弧，零值不绘制。
- 鼠标原生焦点轮廓由全局 `:where(:focus:not(:focus-visible)) { outline: none; }` 清理；保留组件键盘 focus-visible 提示和 Enter/Space 行为。不要使用无条件 `*:focus` 重置。
- 回归需覆盖微小末段与邻段接缝、单档整圆、零值、图例关闭不变更分母；真实页面需点击与键盘切换验收。

### Floating report conversations
- A collapsed report conversation retains its mounted state after first open, so drafts and in-flight context/send locks survive collapse; hidden initialization must not steal focus.
- Explicitly preloaded chat history must prime the shared message cache before rendering consumers; preserve WS changes received while the history request was pending. Normalize a backend null message list at the API boundary.
- Carry the selected report, snapshot date, actual date range and applied cities in the bounded report context block; preserve user blackboard notes.

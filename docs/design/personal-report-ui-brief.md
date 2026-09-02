# Personal report UI brief

## Design read

Di Agent 的个人报表是嵌入 Agent 对话与报表中心的日常分析工作区，目标是让用户在不离开上下文的情况下查看真实查询结果，并以明亮、克制的轻磨砂玻璃语言呈现可信的数据层级。

## Scope

- In scope: 对话内个人报表工作区、报表中心“我的报表”、个人报表消息卡片，以及它们的空、加载、失败、选择、悬停、焦点和响应式呈现。
- Out of scope: Agent 数据查询工具、报表生成业务规则、数据权限策略、API 合约变更、公共报表视觉重构和部署发布。
- Must preserve: `/api/personal-reports` 用户隔离、现有导航路由、对话切换时关闭工作区、真实数据缺失时不生成推测数字。
- Permitted structural changes: 个人报表面板的局部工具栏、全屏与桌面宽度调整、移动端覆盖式展示。

## Visible role and permission states

- 当前用户只看到自己的个人报表。
- 无真实报表时不显示不可用的风格、来源或版本工具，只显示可信空状态。
- 请求失败显示原因与重试入口；不把公共报表后台错误泄漏到个人报表页面。

## Primary journeys

1. 用户在 Agent 对话点击个人报表入口，在桌面右侧打开，在平板和手机覆盖主对话区域。
2. Agent 生成报表卡片后，点击整张卡片打开对应报表。
3. 用户在报表中心切换到“我的报表”，从列表选择并阅读；空状态可返回 Agent 对话。
4. 加载失败时保留当前上下文并允许重试；关闭或退出全屏后回到原页面。

## Reference matrix

| Reference | Role | Extract | Reject / exclude |
|---|---|---|---|
| A 均衡工作台原型 | Primary layout and material | 对话与报表并列、轻玻璃标题栏、来源层级、克制圆角 | 原型模拟指标、未接通工具、品牌内容 |
| Existing Di Agent workbench | Navigation and controls | 黑灰主操作、蓝色焦点、Lucide 图标、紧凑工作台密度 | 无意义装饰和页面级营销结构 |
| DataSeek | Report readability | 结论优先、数字层级、图表留白 | 直接复刻布局、品牌和暗色调 |

## Information hierarchy

- First: 报表标题、状态、更新时间和真实数据来源。
- Second: 报表区块与数据内容。
- Third: 查询标识等溯源信息。
- Empty state: 一句话说明真实数据生成路径与单一主动作。
- Desktop: 右侧 45% 工作区；小于 1280px 覆盖主对话；小于 720px 同时收起会话列表。

## Visual tokens

- Canvas: cool light neutral with a very narrow blue-grey atmospheric tint.
- Glass surface: 78–92% white, 20px blur, subtle white edge highlight.
- Text: `#1d1d1f`, secondary neutral grey; interface accent remains charcoal, blue reserved for focus.
- Data colors: teal, blue, amber, coral and violet, used only for real data series or semantic states.
- Type: existing SF Pro / PingFang stack; display titles use display stack; numbers use tabular figures.
- Spacing: 4px base; primary gaps 8/12/16/24px.
- Radius: 8px controls, 12px primary surfaces, 16px floating empty/state panels.
- Elevation: embedded, raised, overlay; no decorative shadow beyond those levels.

## Material and floating-layer rules

- Glass is limited to the composer shell, sticky toolbar, report canvas and transient state panels.
- Report content remains high-opacity for chart and text legibility.
- Desktop composer is embedded; tablet is an overlay within the chat workspace; mobile occupies the available canvas.
- Fullscreen is a single floating layer below task/toast layers and never covers the global rail.

## Component behavior

- Report tabs and list rows: whole row clickable; hover, selected and focus-visible are distinct.
- Loading: visible spinner and stable minimum height.
- Empty: custom icon, concise copy and at most one primary action.
- Error: semantic icon, restrained error surface, error copy and retry where available.
- Buttons retain native keyboard behavior and a visible focus ring.

## Motion language

- Panel and state entrances use opacity and transform only, 160–240ms, ease-out.
- Hover feedback is 120–160ms and does not move dense text.
- Width drag has no transition while dragging; fullscreen transition is short and causal.
- `prefers-reduced-motion` and `prefers-reduced-transparency` collapse effects to static opaque surfaces.

## Responsive and accessibility

- Validate at 1440×900, 1024×768 and 390×844.
- Touch controls are at least 40px on mobile.
- Long Chinese titles wrap at two lines in content and truncate in navigation lists.
- Focus, selected, status and error meaning do not rely on color alone.

## Technical plan

- Keep React, CSS Modules, Ant Design controls, Lucide icons and Zustand.
- Add no UI dependency.
- Extend existing workbench semantic tokens with scoped personal-report tokens.
- Preserve personal report type, store and route contracts.

## Validation plan

- Capture composer empty and populated-compatible shells, personal report library, loading/error styles, and one interaction-heavy state.
- Inspect hierarchy, spacing, contrast, overflow, focus, overlay collision and mobile reflow.
- Run TypeScript/Vite production build and existing Go compile/card validation checks.

## Decision ledger

| Decision | Status | Choice | Basis |
|---|---|---|---|
| Interaction mode | confirmed | Persistent default-selection | User said “使用默认模式” |
| Visual language | defaulted | Restrained bright glass | User preference plus A prototype |
| Density | defaulted | Medium daily-workspace density | Long-running analysis workflow |
| Interface accent | defaulted | Charcoal, blue focus only | Existing workbench and chart color clarity |
| Reference roles | defaulted | A prototype / workbench / DataSeek split | Coherent product fit |
| Tool visibility | defaulted | Show real tools only when backed by a report | Avoid fake controls |
| Geometry | defaulted | 8/12/16 radius scale | Existing tokens and restrained materiality |
| Motion | defaulted | Subtle causal feedback | Accessibility and performance |
| Mobile | confirmed | Basic full-canvas viewing | Prior user approval and Pass 1 evidence |
| Backend and agent query integration | out of scope | Normal engineering workflow | Not a visible UI decision |

## Gate ledger

| Gate | Status | Basis | Scope | Conditions | Invalidated by |
|---|---|---|---|---|---|
| 0 Context audit | auto-approved | Existing code, A prototype, screenshots and running product inspected | Personal report UI | Preserve routes and real-data honesty | Upstream scope change |
| 1 UI brief | auto-approved | This document and defaulted decisions | Personal report UI | No high-impact visible ambiguity | User returns to detail mode |
| 2 Direction | auto-approved | Reference matrix and bright-glass direction | Visual system | Restrained glass only | Visual-direction change |
| 3 Structure | auto-approved | Pass 1 desktop/tablet/mobile evidence | Composer and library | Existing IA preserved | Layout change |
| 4 Tokens | auto-approved | Semantic token system defined above | Personal report modules | Compatible with workbench | Design-system change |
| 5 States and motion | auto-approved | Behavior and motion definitions above | Personal report modules | Reduced effects supported | Interaction change |
| 6 Prototype | auto-approved | Variant A accepted earlier | Pilot composer | Production interpretation remains traceable | Prototype rejection |
| 7 Production | auto-approved | User-authorized local UI work | Frontend local files | No deployment | Scope expansion |
| 8 Passes | auto-approved | Four production passes rendered at 1440, 1024 and 390 | Production UI | No unexplained high-impact discrepancy | Upstream invalidation |
| 9 Delivery | auto-approved | Local build, API interaction and rendered evidence complete | Local workspace | Deployment remains out of scope | — |

## Auto-advance record

Confirmed: A layout direction, mobile basic viewing and production implementation. Defaulted: restrained light glass, medium density, charcoal interface accent, scoped materiality, causal motion and delayed unavailable tools. Gate 0–9 are auto-approved for local delivery.

## Rendered validation record

- Viewports: 1440×900, 1024×768 and 390×844.
- States: truthful empty state, populated saved report, style selected and saved, fullscreen, desktop keyboard resize, tablet overlay and mobile library reflow.
- Interaction evidence: changing `glass` to `business` returned the saved report and advanced revision from 1 to 2; temporary UI acceptance data was deleted afterward.
- Layout audit: document dimensions matched 1440×900 with no accidental page overflow; the personal report page exposed no alert after background public-report failures.
- Five highest-impact corrections: mobile narrow-column failure; bland and low-hierarchy empty/report surfaces; unavailable controls shown too early; background public-report errors leaking into the personal tab; task-progress overlay colliding with style controls and redundant small-screen fullscreen.
- Intentional limitations: section bodies render only when the Agent generation contract supplies data; the Agent query/generation toolchain and public-report source credentials remain outside this UI brief.

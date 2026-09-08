# UI brief

Mode: myuiskill detail mode. High-impact choices confirmed by user: compact top Agent selector, local Skills default expanded, preserve library operations, transparent reply activity. Remaining presentation safely inferred from existing Ant Design/CSS module interface; no open blocking choice.

Scope: SkillsView / AgentSkillsPanel and reply tool activity. Preserve permissions and platform library actions. No visual system migration.

Reference roles: current app tokens/Ant Design for visual language and controls; DeepSeek Harness for replayable skill/tool lifecycle. No new dependencies or copied branding.

Hierarchy: compact heading + searchable Agent selector, local skill list with search and detail first; platform assigned/library secondary tabs. User correction CONFIRMED: reply has only a 查看执行链路 button, opening a separate Drawer with chronological type/name/status rows and expandable input/results. Do not insert trace summaries into reply prose. Drawer chosen from user's permitted popup alternative using existing AntD conventions; no flip animation.

Tokens: reuse --color-bg*, --color-text*, --color-border*, --color-primary and existing spacing/radius. Neutral surfaces, one primary accent; semantic success/error only. Existing icon library. No gradients or new marketing headers.

Responsive: desktop 1440 and laptop 1024 selector inline; mobile 390 wraps to full width and skill list one column. Long names/paths wrap; no horizontal page overflow. Native button/select keyboard behavior, focus-visible and reduced-motion inherited/supplemented.

States: loading, error retry, no Agent, no local skill, no search match, disconnected/local path unavailable; activity pending, success, error, no captured events and old message fallback. No state claims current availability or successful use without evidence.

Primary paths: Skills navigation → select Agent → local search → open skill metadata/location → switch platform tabs. Chat → submit real task using MCP/Skill → inspect activity → reload and replay.

Gate ledger: 0–5 auto-approved from previous online audit, user's explicit choices, existing token/component evidence and defined states. 6 pilot integrated rather than throwaway; 7 auto-approved for scoped production edits. 8/9 pending rendered desktop/laptop/mobile and real product path evidence.

Gate 8/9: auto-approved after rendered Skills/search/detail/library-copy and real
Codex success/MCP/failure/reload acceptance; evidence in verification.md. Fixed
long-card density and real no-argument tool transient crash during acceptance.
Remaining runtime limitation: tools that do not expose native invocation events
cannot be reported as fully traced; the UI explicitly distinguishes no events.
Delivery is local implementation/preview; production deployment remains out of scope.


## 用户图片追加：Harness 式轨迹（2026-09-08）

回复旁仍只有「查看执行链路」，详情升级为宽独立 Drawer，桌面 min(1180px,94vw)，390px全宽。顶部输入／模型公开输出／Skill／MCP与工具四泳道，分别蓝／紫／绿／橙；下方按真实block顺序保留调用与返回事件行。点击色条选中、展开并定位明细，支持名称／参数／结果搜索和类型筛选。并发重叠事件用泳道内子轨道保留可见性。

时间来源只使用 daemon 观测事件时间，blocks started_at/ended_at 持久化。工具耗时仅从call开始至匹配result结束；未录开始或结束不推算。时间模式中缺时间事件独立显示为「无时间戳」按钮，不放入计时轴；全部旧数据退回按顺序等宽条。图只展示可公开text，不展示或推断隐藏thinking。用户输入仅来自当前会话已加载、reply_to ID精确匹配且role=user的完整源消息，使用源消息created_at；截断reply_to_message预览和Agent派工引用不冒充用户输入。

Gate：新行为回归先红后绿；24项初步测试及类型检查通过。用户认可的图片方向沿用本地tokens、CSS Modules和可键盘操作的色条，无新依赖。最终宽屏／390px和真实带时间事件回放由主代理继续验收。

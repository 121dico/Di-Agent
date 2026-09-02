# Report workspace UI brief

## 1. Design read

The report workspace is a daily-use analytical surface for viewing fixed business reports, filtering a real data snapshot, comparing trends, querying one user, and—when already authorized—browsing detail or maintaining report definitions. It should feel like the same light, restrained Di Agent workbench rather than a decorated dashboard template.

## 2. Scope

- In scope: `/reports`, report hub tabs, report catalog, report heading and metadata, global filters, metric overview, score and volume trends, sensitivity distribution, user query, administrator detail table and run history, public loading/empty/error presentation, the surrounding personal-report library shell, and daily analytics cache completeness needed to render an honest trend.
- Out of scope: metric definitions, date semantics, authentication, authorization, scheduled execution, source signing/credential rotation, and source configuration behavior.
- Must preserve: public/personal workspace switch, existing report selection, city and range filters, legend visibility controls, DUID exact search, administrator-only actions/detail/history, table sorting/pagination, downloads, modals, and real-data-only behavior.
- Permitted: production DOM/CSS changes within report presentation, local interaction state for charts, semantic chart palette changes, and responsive reflow.

## 3. Visible role and permission states

- Normal users retain public metrics, trends, distribution, and exact-DUID search. Full detail, run history, source management, report creation/editing, generation, and downloads stay absent when policy already denies them.
- Administrators retain all current controls and full-detail surfaces. Management actions remain visually secondary to report reading; `立即生成` remains the primary admin action.

## 4. Primary journeys

- Enter reports → choose a report → understand status and headline metrics → filter city/range → compare trends/distribution.
- Query a DUID → submit exact value → inspect result, empty result, or retained failure feedback.
- Administrator → inspect detail and run history or use existing management actions.
- Loading/empty/error states occupy the same geometry as their eventual content and avoid invented data.

## 5. Reference matrix

- Di Agent Workbench: primary shell, type hierarchy, graphite actions, restrained radius, thin separators, route motion.
- Linear/Attio: frameless tabs, compact control density, selected underlines, neutral surfaces, small status metadata.
- Apple analytical surfaces: legible numeric typography, quiet gridlines, generous plot padding, direct pointer feedback. No Apple brand assets or copied product content.
- Excluded: ornamental gradients, glass on persistent content, thick shadows, oversized pills, fake preview curves, and marketing-style hero composition.

## 6. Information hierarchy

1. Report title, health/freshness, and administrator actions.
2. Report selector and global filter context.
3. Six concise metrics.
4. Large score trend.
5. Volume trend and sensitivity distribution.
6. Exact user query.
7. Administrator detail and run history.

## 7. Visual tokens

- Canvas/surfaces: existing `--wb-app`, `--wb-surface`, and `--wb-surface-subtle`.
- Text/borders: existing workbench semantic tokens.
- Structural accent: `--wb-focus` blue; graphite remains the primary action color.
- Data palette: blue, teal, violet, amber, coral, with gray only for unavailable/unknown values.
- Typography: system/SF stack; tabular figures; 28–32 px headline values, 12–14 px labels, 10–11 px metadata.
- Geometry: 8 px base spacing; 8–12 px control/surface radii; no persistent card shadow.

## 8. Materials and layers

- Persistent report content is opaque and flat with thin borders.
- Only chart tooltips, dropdowns, modals, and transient feedback may float with restrained elevation.
- At most one report tooltip is visible per chart. Tooltips never cover the active data point when avoidable.

## 9. Component behavior

- Tabs and range selectors use an underline rather than filled pills.
- Legend controls are real buttons with `aria-pressed`; disabling a series reduces opacity without strikethrough.
- Score trends default to one focused primary metric (`价敏均分`) so its real daily movement is legible; D1/D2/D3 remain opt-in comparison lines.
- Trend charts use a padded real-value domain, expose its visible numeric range, and show latest/change/spread. They do not force score data onto 0–100 unless the observed range actually requires it.
- A single real date is rendered as a baseline point with an explicit explanation, never as an invented horizontal line. A path requires at least two real dates.
- User and order volume use separate real-value axes because their magnitudes differ; neither series is normalized or interpolated.
- Trend charts expose a vertical guide, active points, date, and all visible values on pointer/keyboard focus.
- Donut segments and legend rows share hover/selected feedback and retain click-to-hide behavior.
- Tables keep sticky identity columns, sortable headers, keyboard focus, hover rows, and explicit empty/loading states.

## 10. Motion

- 120–220 ms control and tooltip feedback; chart paths enter once in 500–700 ms.
- No perpetual preview animation and no fake chart data.
- Reduced-motion removes path drawing, point/bar entrances, and translate effects.

## 11. Responsive/accessibility

- Desktop ≥1180: report catalog + content; trend width dominates.
- Laptop 840–1179: catalog becomes a horizontal selector; filters wrap; charts stack where needed.
- Compact ≤680: single-column content, horizontally scrollable tabs, 44 px touch controls, table overflow preserved.
- Visible focus, semantic buttons, `aria-pressed`, chart descriptions, keyboard-accessible chart hit areas, and no color-only selection.

## 12. Technical plan

- Keep React, CSS Modules, Ant Design form controls, Lucide/current icons, existing API/store contracts, and native SVG charts.
- Do not add a chart dependency. Deepen the local SVG chart component with hover/focus state and reusable presentation helpers.
- Validate cache coverage before treating persisted rows as a complete range. Query and persist all source trend dates when coverage is partial; if the source is unavailable, return the available real dates as an explicitly partial baseline rather than a blank/fabricated chart.
- Primary files: `ReportsView.tsx`, `ReportsView.module.css`, `reportPresentation.ts`, `report_runner.go`, and focused tests.

## 13. Validation

- Render actual product at desktop/laptop/compact widths.
- Validate the signed-in `121` report with its persisted real snapshot and the current source-unavailable fallback; do not fabricate production figures.
- Validate chart behavior with focused component/presentation tests and rendered DOM geometry.
- Run all frontend `src` tests and production build.

## 14. Decision ledger

- confirmed: light Di Agent workbench, whole report UI synchronization, all chart sizing/styles/interactions, real data only, existing role visibility.
- defaulted: compact analytical hierarchy; neutral page + blue structural accent; semantic multicolor only inside data; primary score focus; real-value dynamic axes; separate volume plots; interactive guide/tooltip charts; responsive catalog collapse.
- assumed: existing data fields and `dt` labels remain authoritative and unchanged; a missing source response must not be replaced with generated or interpolated dates.
- open: none for the authorized local UI scope.
- out of scope: auth/permissions/scheduler/deployment changes.

## 15. Gate ledger

| Gate | Status | Basis | Scope |
| --- | --- | --- | --- |
| 0 Context | auto-approved | Current code, running page, tokens, permissions, and empty/failure state inspected | report UI only |
| 1 Brief | auto-approved | All material visible decisions confirmed/defaulted above | local production UI |
| 2 Direction | auto-approved | Workbench + Linear/Attio + analytical Apple traits assigned coherent roles | visual direction |
| 3 Structure | auto-approved | Title → selector/filter → metrics → trends/distribution → query → detail/history | report route |
| 4 Tokens | auto-approved | Existing workbench tokens plus semantic chart palette and real-value chart scale | report components |
| 5 Interaction | auto-approved | Primary score focus, comparison toggles, tooltip/guide, explicit date range, and independent volume plots | report interactions |
| 6 Acceptance | auto-approved | Signed-in `121` route rendered 31 real daily points from 2026-07-28 through 2026-08-27 in ascending order, independent volume domains, and the three-level donut | local evidence |
| 7 Production | auto-approved | Frontend chart presentation, exact 31-day range, static-signature development fallback, and backend daily-cache coverage updated without changing metric contracts | report UI + analytics cache |
| 8 Passes | auto-approved | Partial-cache and exact-31-day regressions reproduced and corrected; the running product then backfilled all 31 real dates from the source | local code and runtime |
| 9 Delivery | auto-approved | Focused report frontend/backend tests and production build passed | local only; deployment excluded |

### Acceptance evidence

- Signed-in `121` report renders persisted real values: 41,958,976 total users, 70,273,417 orders, 7,978,735 calculated users, and the real high/medium/low distribution.
- The internal source returned 31 real aggregate dates. The report defaults to `2026-07-28 → 2026-08-27`, sorts chronologically, and exposes every daily point through the chart interaction layer.
- Score focus is `价敏均分`; D1/D2/D3 are initially muted but remain interactive. Volume plots use independent real-value domains, so users and orders remain visually legible at their own scales.
- Regression tests verify a one-day cache cannot short-circuit a multi-day request, the 31-day range includes both requested endpoints, successful source results persist every trend date, and an unavailable source falls back to the honest partial cache.
- Validation: focused report frontend/backend tests and production build passed with only the existing large-chunk advisory.

## 16. Increment-first report revision

### Design read

The public price-sensitivity report is a daily operational analysis surface: its first task is to expose day-over-day net user change, cumulative change from the selected-period baseline, and growth rate without presenting a rolling 180-day stock as daily acquisition.

### Scope and hierarchy

- Primary metrics: current calculated users, period cumulative net growth, latest daily net growth, latest growth rate, average daily net growth, and current coverage.
- Primary chart: signed daily net-growth bars with a visible zero baseline.
- Secondary charts: cumulative net-growth line and daily growth-rate line, each with independent real-value scales.
- Supporting analysis: current sensitivity distribution and the score trend remain available below the increment story.
- Existing city/range filters, exact-DUID search, administrator detail access, run history, and source management remain unchanged.
- The first selected date is a baseline with zero change. No missing predecessor is invented.
- `d1_recent_order_count` remains a trailing-window reference and is not labelled as real daily order acquisition.

### Visual and interaction defaults

- Defaulted: light workbench tokens, blue for daily net growth, teal for cumulative change, violet for rate, and semantic red only for negative bars/values.
- Defaulted: restrained embedded surfaces, 8px spacing rhythm, existing report radii and borders, no new decorative glass or gradients.
- Defaulted: hover and keyboard-focus date inspection, series toggles, signed labels, zero baseline, loading/empty/error preservation, and reduced-motion support.
- Defaulted responsive behavior: two-column secondary analysis at desktop, one-column at laptop/mobile, horizontal date density reduced rather than scrolling the whole page.

### Gate ledger

| Gate | Status | Basis | Scope |
| --- | --- | --- | --- |
| 0 Context | auto-approved | Existing report route, real 31-day data, role states, chart components and tokens inspected | increment revision |
| 1 Brief | auto-approved | User fixed the incremental outcome; remaining visible choices defaulted | report UI |
| 2 Direction | auto-approved | Existing light Di Agent workbench retained; operational delta hierarchy replaces snapshot-first hierarchy | visual direction |
| 3 Structure | auto-approved | Metrics → daily delta → cumulative/rate → distribution/score → query/detail/history | report route |
| 4 Tokens | auto-approved | Existing tokens plus semantic positive/negative data colors | charts and metrics |
| 5 Interaction | auto-approved | Independent scales, zero baseline, tooltip/focus, toggles, honest baseline and error states | report interactions |
| 6 Prototype | auto-approved | Existing production chart primitives are the lower-risk pilot seam | local production route |
| 7 Production | auto-approved | `ReportRunner.QueryAnalytics`, report presentation model, report charts and styles are in scope | local code |
| 8 Passes | in progress | Structure, visual, states, motion/responsive and screenshot loops required | local UI |
| 9 Delivery | open | Requires tests, build and human-path acceptance | local only |

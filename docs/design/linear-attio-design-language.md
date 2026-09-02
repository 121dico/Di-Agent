# Di Agent — Linear × Attio design language

## Direction

Di Agent uses Linear's precision for agent workflows and Attio's clarity for
data-heavy surfaces. The product should feel like one authored system, not a
collection of dashboard cards.

## Visual grammar

- **Bright neutral navigation:** a warm off-white primary rail creates a stable
  frame without making the product feel dark or tool-like.
- **Warm content canvas:** secondary lists use a warm gray; detail and report
  surfaces use warm white instead of blue-gray glass.
- **One accent:** deep teal is reserved for selection, focus, primary actions and
  live agent activity. Status colors keep their semantic meaning.
- **Structure is felt, not drawn:** continuous surfaces and alignment establish
  layout first. Hairline separators only appear where two regions genuinely
  need to be distinguished; shadows belong to transient overlays only.
- **Compact hierarchy:** 32–36 px rows, 12–14 px interface type, and 20–28 px
  page titles. Density comes from alignment, not tiny text.
- **Calm motion:** 140–180 ms color/opacity transitions for controls; 220 ms
  ease-out for drawers and overlays. No floating cards or decorative entrance
  animation.

## Component rules

- Sidebar items are full-width rows with monochrome icons. Active state uses a
  slim accent marker and stronger text rather than a rounded outline or pill.
- Toolbars contain the view title, search/navigation and no more than one
  visually primary action.
- View and range tabs are plain text on a shared baseline. The selected tab is
  marked by a short 2 px underline; the group itself has no enclosing capsule.
- Lists use typography, markers and at most a barely visible hover fill instead
  of outlines or lifted cards.
- Cards are reserved for real interactive objects such as a task or report
  visualization. Metric groups use a continuous surface and internal hairlines.
- Inputs sit on a slightly tinted surface; focus is a thin indigo ring.
- Tables use sticky headers, subtle row separators and restrained zebra fill.
- Agent progress is a timeline/list first; glass is limited to the movable
  utility window.
- Reports use Attio-like filtering, metric groups and data grids on the warm
  content canvas.

## Visual references checked

- Linear's 2026 interface refresh: smaller icons, quieter inactive text,
  warmer neutral themes and fewer separators.
- Linear's app redesign examples: the inverted-L application chrome, compact
  view headers and high-density navigation.
- Attio table views: spreadsheet-like continuous grids, inline filters and
  column controls rather than dashboard-card nesting.
- Attio report builder: data source first, then metric/grouping/visualization;
  charts remain directly connected to the underlying contributing rows.

## Tokens

- Navigation: #f5f6f4
- Navigation elevated: #ffffff
- Canvas: #f7f6f3
- Surface: #fffefa
- List surface: #f1f0ed
- Primary text: #242321
- Secondary text: #706e69
- Separator: rgba(36, 35, 33, 0.12)
- Accent: #0f766e
- Accent hover: #0d675f
- Selection: rgba(15, 118, 110, 0.10)

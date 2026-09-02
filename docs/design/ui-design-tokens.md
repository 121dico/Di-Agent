# Di Agent Gate 4 — design tokens and component language

> Presented: 2026-08-27  
> Status: Gate 4 approved on 2026-08-27  
> Boundary: exact token proposal only; no dependency installation, prototype, or production edit

## 1. Token principles

- Color-neutral does not mean low contrast.
- Persistent surfaces are flat; shadows indicate actual elevation.
- One component has one geometry and state contract across routes.
- Compact visual controls retain accessible hit areas and focus states.
- Exact values may change only after rendered evidence shows a contrast, collision, or legibility problem; role relationships remain fixed.

## 2. Color system

### Neutral and action tokens

```css
:root {
  color-scheme: light;

  --color-canvas-outer: #f3f2ef;
  --color-app: #f7f7f5;
  --color-surface: #ffffff;
  --color-surface-subtle: #f7f7f5;
  --color-surface-raised: rgba(255, 255, 255, 0.82);
  --color-surface-hover: #f1f1ef;
  --color-surface-pressed: #eaeae7;
  --color-surface-selected: #eef5ff;

  --color-text-primary: #1d1d1f;
  --color-text-secondary: #5f6368;
  --color-text-tertiary: #686b70;
  --color-text-disabled: #9a9a9e;
  --color-icon-muted: #7d7f83;

  --color-border-subtle: #e5e5e2;
  --color-border-default: #d8d8d4;
  --color-border-strong: #bdbdb8;
  --color-separator: rgba(29, 29, 31, 0.09);

  --color-action-primary: #1d1d1f;
  --color-action-primary-hover: #343436;
  --color-action-primary-pressed: #080809;
  --color-on-primary: #ffffff;

  --color-link: #005fcc;
  --color-focus: #0a66ff;
  --color-selection: #e5f0ff;
}
```

Contrast verification against white:

| Foreground | Ratio | Role |
| --- | ---: | --- |
| `#1d1d1f` | 16.83:1 | primary text/action |
| `#5f6368` | 6.05:1 | secondary text |
| `#686b70` | >5:1 | tertiary essential text |
| `#005fcc` | 5.98:1 | links/action text |

`#9a9a9e` is restricted to disabled/nonessential content and must not carry required information.

### Semantic tokens

```css
:root {
  --color-info: #005fcc;
  --color-info-bg: #eef5ff;
  --color-success: #167c46;
  --color-success-bg: #eef8f1;
  --color-warning: #9a5700;
  --color-warning-bg: #fff5e8;
  --color-error: #c2352a;
  --color-error-bg: #fff0ef;
}
```

Each semantic state uses icon + text + color. Status text values meet normal-text contrast on white/light surfaces; tinted backgrounds are supporting signals only.

### Data visualization tokens

```css
:root {
  --chart-graphite: #2c2c2e;
  --chart-blue: #3b73c8;
  --chart-green: #4e8a68;
  --chart-orange: #b8792b;
  --chart-red: #c65a52;
  --chart-grid: rgba(29, 29, 31, 0.09);
  --chart-axis: #686b70;
  --chart-tooltip-bg: rgba(29, 29, 31, 0.94);
  --chart-tooltip-text: #ffffff;
}
```

Usage order:

1. Single series: graphite or blue.
2. Two series: graphite + blue.
3. Additional independent series: green, orange, then red.
4. Error/threshold meaning overrides sequence and uses semantic red/orange.
5. Price-sensitivity distribution: high = muted red, medium = muted orange, low = blue; labels and values remain present so color is never the sole distinction.
6. Hidden series reduces opacity and updates its legend state; it is not converted to gray that could be confused with graphite data.

Charts use different point/line markers when more than three series overlap. Chart color itself is not reused as interface chrome.

## 3. Typography

### Font stacks

```css
:root {
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC",
    "Segoe UI", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  --font-mono: "SFMono-Regular", "Cascadia Code", "JetBrains Mono", Consolas,
    "Liberation Mono", monospace;
}
```

- No bundled SF font files.
- Code, terminal text, hashes, and raw identifiers use the mono stack.
- Metrics, dates, durations, charts, and tables use `font-variant-numeric: tabular-nums lining-nums` in the UI stack.

### Type roles

| Token | Size / line | Weight | Use |
| --- | --- | ---: | --- |
| `display` | 28 / 36 | 600 | true empty/overview moment only |
| `page-title` | 22 / 28 | 600 | page/workspace title |
| `section-title` | 17 / 24 | 600 | major section/inspector title |
| `subhead` | 15 / 22 | 600 | cardless section or row group |
| `body` | 14 / 21 | 400 | chat, settings, descriptive text |
| `body-strong` | 14 / 21 | 600 | primary row text/emphasis |
| `control` | 13 / 18 | 500 | buttons, tabs, inputs |
| `metadata` | 12 / 16 | 400/500 | time, status, supporting labels |
| `micro` | 11 / 14 | 500 | rare compact count/shortcut only |
| `code` | 13 / 20 | 400 | inline/block code default |

Rules:

- Primary operational text never uses `micro`.
- Page titles prefer one line; wrap to two only when the available content width is genuinely narrow.
- Long Agent output uses a readable measure around 72–80 Chinese characters/appropriate Latin equivalent, not the entire monitor width.
- Avoid letter-spacing on Chinese body text; uppercase English micro-labels are not a default hierarchy tool.

## 4. Spacing and layout tokens

```css
:root {
  --space-0: 0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  --app-inset-wide: 16px;
  --rail-collapsed: 56px;
  --rail-expanded: 224px;
  --conversation-panel: 288px;
  --conversation-panel-min: 256px;
  --inspector-default: 400px;
  --inspector-min: 360px;
  --inspector-max: 560px;
  --content-reading-max: 840px;
}
```

Local component gaps can use 6 px only when 4 or 8 px produces visibly incorrect optical spacing; 6 px does not become a new global rhythm.

## 5. Radius, border, and elevation

### Radius

```css
:root {
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-control: 8px;
  --radius-panel: 10px;
  --radius-panel-lg: 12px;
  --radius-floating: 16px;
  --radius-pill: 999px;
}
```

- Checkbox and small code/shortcut cells may use 4–6 px.
- Controls default to 8 px.
- Persistent large surfaces never exceed 12 px.
- Floating composer/progress/dialog can use 16 px.
- Pill is a semantic shape, not a universal style.

### Border

- Structural separator: 1 CSS px using `--color-separator`.
- Interactive control: 1 px `--color-border-default`.
- Hover control: `--color-border-strong` only when fill is insufficient.
- Focus: 2 px `--color-focus` outside the component; no layout change.
- Selected and focus may coexist: selected fill remains, focus ring sits outside.

### Elevation

```css
:root {
  --shadow-none: none;
  --shadow-raised:
    0 0 0 1px rgba(29, 29, 31, 0.04),
    0 2px 8px rgba(29, 29, 31, 0.06);
  --shadow-overlay:
    0 0 0 1px rgba(29, 29, 31, 0.06),
    0 8px 24px -8px rgba(29, 29, 31, 0.18);
  --shadow-floating:
    0 0 0 1px rgba(29, 29, 31, 0.07),
    0 18px 48px -16px rgba(29, 29, 31, 0.24);
}
```

- `raised`: toolbar cluster, composer at rest.
- `overlay`: menus, popovers, inspectors in overlay mode.
- `floating`: draggable Task window and blocking dialog only.
- Persistent navigation, data grids, and docked inspectors use no shadow.

## 6. Translucency and material

```css
:root {
  --glass-bg: rgba(255, 255, 255, 0.82);
  --glass-bg-strong: rgba(255, 255, 255, 0.92);
  --glass-border: rgba(29, 29, 31, 0.08);
  --glass-blur: 20px;
  --glass-saturate: 1.08;
}
```

Implementation contract:

- `backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate))` only on approved floating surfaces.
- Always provide `--color-surface`/strong opaque fallback.
- Use stronger opacity when text/code scrolls underneath.
- Reduce or remove blur under reduced transparency, browser incompatibility, GPU pressure, or high-contrast mode.
- Never stack two large translucent surfaces directly over each other.

## 7. Icon system

- Style: Lucide-like neutral outline.
- Stroke: 1.75 px default; 2 px only for tiny 14 px icons requiring optical correction.
- Sizes: 14 px metadata, 16 px controls, 18 px navigation, 20 px primary actions, 24 px empty-state/brand support.
- Icons inherit text color by default.
- Icon-only controls require accessible names and tooltips after a short delay.
- Filled icons are reserved for selected checkbox/radio, critical status, or compact unread indicators.
- Do not mix Ant Design and Lucide silhouettes within one accepted component.

Dependency proposal for production Gate 7: add `lucide-react`; do not add a motion library initially. CSS transitions and existing pointer logic cover the pilot. A motion dependency requires separate evidence if native CSS cannot reproduce the approved behavior.

## 8. Z-index and layer tokens

```css
:root {
  --z-base: 0;
  --z-sticky: 10;
  --z-nav-overlay: 20;
  --z-inspector: 30;
  --z-task-utility: 40;
  --z-popover: 50;
  --z-drawer: 60;
  --z-modal: 70;
  --z-critical: 80;
  --z-toast: 90;
}
```

Toasts can have a high technical layer but must be positioned away from blocking controls; z-index does not permit visual collision.

## 9. Component geometry

| Component | Default geometry | Notes |
| --- | --- | --- |
| compact rail | 56 px wide | 18 px icons; overlay expands to 224 px |
| navigation item | 36 px visual row, ≥40 px hit area | frameless; quiet hover fill |
| page header | 52 px minimum | title on grid; actions in separate cluster |
| conversation panel | 288 px | narrows to 256 px before changing mode |
| conversation row | 52–60 px | title + one summary/status line |
| standard button | 34 px high | 8 px radius; 12 px horizontal padding |
| large primary button | 40 px high | limited to strong create/confirm actions |
| icon button | 32 px visual, 40 px hit area | tooltip + accessible name |
| text/select field | 36 px high | 8 px radius; visible focus ring |
| frameless tab | 36 px high | active underline/marker; no shared pill shell |
| chat transcript | max 840 px reading measure | centered in available chat canvas |
| composer | max 840 px; 16 px radius | 20–24 px bottom/side breathing room |
| right inspector | 400 px default | resizable 360–560 px |
| Task capsule | 36 px high | content width capped; never full toolbar |
| Task window | 320×520 px default | resizable 280–560 × 360–760 px; viewport-clamped |
| popover/menu | 240–320 px typical | content-driven, 12 px radius |
| blocking dialog | 480–640 px typical | 16 px radius; explicit title/actions |
| tooltip | content-driven | 6 px radius; no essential content only in tooltip |

## 10. Component-state language

### Buttons

- Primary: graphite fill, white label, no default shadow.
- Secondary: white/transparent surface, subtle border or hover fill.
- Tertiary: borderless label/icon; hover fill only.
- Destructive: neutral by default when in overflow; semantic red in confirmation/final action.
- Loading retains width, label context, and a local spinner.

### Navigation and tabs

- Current route: stronger text/icon plus a compact marker and quiet surface contrast.
- Hover: immediate subtle fill, no translate/scale.
- Overlay rail expansion does not change the current marker.
- Tab active: text contrast + 2 px short underline; no entire rounded selection container.

### Inputs and composer

- Default uses one border/background layer.
- Hover increases border clarity slightly.
- Focus uses 2 px external blue ring.
- Invalid uses semantic error border/message without removing the focus ring.
- Composer context chips render only when context exists and wrap before reducing editor width.

### Lists and tables

- Continuous rows with hairline separation or spacing, not independent cards.
- Hover, keyboard highlight, selected-for-bulk, and current/open are separate states.
- Essential row controls are always accessible; low-frequency controls may reveal on hover/focus.
- Sticky header uses an opaque/strong material so scrolling data does not reduce legibility.

### Task and Agent state

- Running: text + subtle activity glyph; continuous animation only while active.
- Attention/error: semantic icon and concise text with recovery entry.
- Completed: check + completion text; success color remains restrained.
- Unknown/indeterminate: current phase and elapsed time, never a fake percentage.

### Empty/loading/error

- Empty: concise title, one explanation, one relevant action; no emoji or decorative glow.
- Loading: preserve geometry and last safe data; use skeleton/spinner only inside the changing region.
- Error: attach to the affected row/message/step/panel; retain partial/successful content.
- Offline: one persistent compact banner/state, no toast flood.

## 11. Ant Design mapping boundary

Use `ConfigProvider` semantic tokens as an adapter, not as the design source of truth.

| Ant Design family | Pilot treatment |
| --- | --- |
| Button/Input/Select | Wrap and map to Di tokens; remove default primary blue/shadow/radius silhouette |
| Modal/Drawer/Popover/Tooltip | Keep accessibility/portal behavior initially; replace visible shell/material |
| Form validation | Keep logic; map status copy, border, focus, and messages |
| Table/DatePicker/Pagination | Keep behavior for later routes; retheme only when that route enters migration |
| Menu | Do not use as the new global rail; build the rail as a custom navigation primitive |
| Icons | Replace within pilot; do not mix icon families inside a component |

No CSS selector should globally patch undocumented Ant internal structure when a wrapper/token API can create a stable seam.

## 12. Responsive token behavior

- `≥1440`: 16 px outer inset, full conversation panel, docked inspector allowed.
- `1280–1439`: inset and gaps reduce with `clamp()`; conversation panel can narrow.
- `1024–1279`: zero outer inset; inspector overlays; secondary header actions enter overflow.
- Container queries control composer/action/header adaptation where possible; viewport queries control the global shell.
- Motion, blur, and shadows reduce before text, action, or data density is compromised.

## 13. Exceptions to anti-template constraints

Approved narrow exceptions:

- light glass on composer, command UI, toolbar cluster, and Task utility;
- 16 px radius on those floating layers;
- one draggable floating Task window;
- warm outer inset at wide widths.

Not approved:

- gradient glow backgrounds;
- card wrapper around every message/metric/section;
- shadows on persistent panels/tables;
- glass navigation/table/report body;
- pill-style tabs and filters everywhere;
- invented dashboard data or decorative charts.

## 14. Gate effect

Gate 4 was approved on 2026-08-27, locking these semantic roles, exact starting values, component geometry, elevation/material tiers, icon strategy, layer scale, and Ant Design migration boundary. Rendered testing may correct an exact value only when evidence is documented and the relationship remains intact.

Approval authorizes preparation of the complete Gate 5 interaction/state/motion/responsive behavior specification. It does not authorize dependency installation, prototype generation, production UI edits, or rollout.

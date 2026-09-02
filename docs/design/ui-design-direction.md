# Di Agent Gate 2 — reference and design direction

> Presented: 2026-08-27  
> Status: Gate 2 approved on 2026-08-27  
> Boundary: direction only; no polished visual, prototype, dependency, or production edit

## 1. Direction statement

Build Di Agent as a bright, color-neutral operational workspace: Codex supplies the calm Agent workbench character, Apple supplies material and motion precision, Linear supplies navigation/task mechanics, Attio supplies data/control behavior, and Collective OS contributes only limited presentation depth.

The product must feel intentionally quiet rather than merely gray. Hierarchy comes from typography, alignment, surface contrast, precise spacing, and state behavior before color, glass, radius, or shadow.

## 2. Reference roles

### Codex — primary product character

Use:

- Agent work represented as an ordinary, trustworthy operational state;
- color-neutral continuous work surfaces;
- compact but comfortable controls;
- document-like long-form Agent output;
- peripheral status that does not dominate the main task;
- reduced ornamental branding inside the workspace.

Reject:

- direct reproduction of OpenAI marks, copy, proprietary assets, or exact screen composition;
- treating Codex as a color palette to clone;
- developer-only density that external enterprise users cannot understand.

### Apple HIG — material, type, and feedback

Use:

- platform-native typography and legible contrast;
- restrained translucency on surfaces that genuinely float;
- precise focus, hover, press, drag, and resize feedback;
- gentle easing/spring after direct manipulation;
- light-mode materials that remain readable over real content;
- responsive removal of decorative space before functional space.

Reject:

- glass on tables, navigation, and every card;
- consumer-scale whitespace that reduces daily-use efficiency;
- copying Apple brand marks or redistributing Apple-specific imagery as product identity;
- motion used only to look expensive.

### Linear — navigation and Task operations

Use:

- quiet compact global navigation;
- overlay expansion without work-surface reflow;
- precise active, hover, keyboard-highlight, selected, and current states;
- docked/resizable detail inspector;
- list/board consistency and whole-row activation;
- contextual commands, keyboard access, and bottom bulk-action behavior;
- task rows that remain summaries while detail lives in the inspector.

Reject:

- dark or cool blue-gray default theme;
- overly dim inactive navigation;
- tiny text and unfamiliar icon-only navigation without labels/tooltips;
- copying issue-tracker terminology into Di Agent.

### Attio — data and control behavior

Use:

- continuous data surfaces instead of card-per-row layouts;
- layered page/view/filter hierarchy;
- inline editing and spreadsheet-like scanning where appropriate;
- compact, readable filter and sort state;
- centered global command/search plus anchored contextual presentation;
- clear modal/popover hierarchy and progressive disclosure;
- large Agent composer only where composing is the primary job.

Reject:

- CRM ontology and CRM-specific object models;
- colored pills as decoration;
- exposing every data attribute at once;
- globally shared filter changes without explicit scope.

### Collective OS demo — mood reference only

Use narrowly:

- warm-light outer canvas at wide Web widths;
- selected floating overview modules;
- soft depth around one showcase or utility surface;
- commercial polish in onboarding/home moments.

Reject:

- using the demo as evidence for real filters, search, chat, errors, accessibility, or responsive behavior;
- fixed-height dashboard cropping;
- pervasive 20–40 px radii and large soft shadows;
- mock metrics, portraits, brand gradient, logos, and testimonial content;
- floating decoration over high-frequency work.

## 3. Approved visual-language proposal

### Color and contrast

- Light mode only for this redesign phase.
- Very light warm-neutral outer canvas at wide widths.
- Neutral-white work and reading surfaces.
- Graphite text and graphite-filled primary actions.
- System-like blue only for link, focus, and explicit selection.
- Graphite + blue for single-series data; muted green/orange/red appear only when data semantics or multiple series require them.
- No dominant teal, cobalt, purple, wine, brass, or gradient brand wash.

### Typography and density

- Platform-native Web font stack, including native Chinese UI fonts.
- Tabular figures for report metrics, dates, durations, tables, and chart labels.
- Balanced Codex-like density: navigation and lists efficient; chat, detail, and reports slightly more spacious.
- Avoid both Linear-like tiny text and Apple consumer-page oversizing.

### Geometry

- 8 px control radius.
- 10–12 px persistent panel radius.
- Approximately 16 px for floating/transient layers.
- Pills only for tags, statuses, avatars, and compact segmented controls.
- Tabs and simple choices remain frameless, with a short underline or compact marker.

### Elevation and material

- Persistent navigation, lists, tables, report bodies, reading surfaces, and docked inspectors stay flat.
- Top action groups, command UI, composer, menus/dialogs, Task capsule, and Task progress window may use light translucency/elevation.
- Hairlines and background contrast define structure; shadows communicate actual elevation.
- One large user utility may float at a time, aside from a transient menu/popover.

### Motion

- High-frequency row and selection feedback is immediate.
- Menus and overlays use short opacity/small-travel transitions.
- Drawers, drag release, resizing, and edge snapping use restrained Apple-like easing/spring.
- Charts animate only between valid data states.
- Reduced-motion mode removes travel, pulse, and spring while preserving state information.

### Brand

- User-facing name: `Di Agent`.
- Minimal geometric mark plus wordmark.
- The mark must work alone in a compact navigation rail and favicon.
- Lucide-like neutral line icons for product actions; no robot emoji as primary identity.

## 4. Floating-layer model

### May float

- right-side page action cluster;
- command/search palette and contextual menus;
- chat composer;
- blocking dialog/drawer;
- compact Task status capsule;
- expanded draggable/resizable Task window.

### Must remain embedded/flat

- global icon rail and its overlay-expanded navigation body;
- conversation list;
- chat transcript/document flow;
- report/chart body;
- table grids;
- docked Task/Agent inspector.

### Collision and fallback

- Task window freely drags, remembers geometry, and magnetically snaps near the viewport edge.
- It reclamps after viewport change and may not cover primary actions, the composer, or a blocking dialog.
- At compact widths it can collapse back to its status capsule.
- Blocking dialogs outrank drawers, drawers outrank user utilities, and transient menus remain scoped to their trigger.

## 5. Rejected alternatives

### Apple-first consumer layout

Rejected because large whitespace, large controls, and broad glass would reduce task/report density and make the product feel like a showcase rather than an operational system.

### Linear-first dark/dense clone

Rejected because the required product is bright, shared with external enterprise users, and must not inherit Linear's brand identity or smallest type scales.

### Collective OS-style floating dashboard

Rejected as a production shell because it is a demo composition without sufficient evidence for complex interaction, permissions, errors, or large datasets.

### Strong single brand hue

Rejected because the chosen premium direction is color-neutral; action hierarchy comes from graphite, while color remains functional.

### Full Ant Design reskin

Rejected because the default component silhouette would remain visible. The approved approach is a layered migration with a custom high-frequency surface and wrapped complex controls.

## 6. Direction acceptance criteria

The direction is successful only if:

- the interface remains recognizable as Di Agent, not a clone of any reference;
- bright mode feels calm rather than empty;
- structure remains understandable with most color removed;
- glass and shadows correspond to real z-axis behavior;
- task/agent status is clear without neon or decorative animation;
- dense data remains readable at 1024–1440 px;
- all reference borrowing is behavioral/structural, not asset copying;
- the next structural stage can be specified without revisiting the overall mood.

## 7. Gate effect

Gate 2 was approved on 2026-08-27, locking the reference roles, light visual language, density, material scope, color strategy, and floating-layer model described here. It authorizes preparation of the Gate 3 information architecture and low-fidelity structure only. It does not authorize a polished design, prototype, dependency installation, or production UI change.

# Di Agent Web UI reference deep dive

> Research snapshot: 2026-08-27  
> Target: desktop Web, designed at 1440 px and fully usable down to 1024 px  
> Production references: **Attio + Linear**  
> Visual mood reference only: **Collective OS demo**

## 1. Executive decision

Di Agent should not reproduce any one reference product wholesale. The most defensible combination is:

- Use **Attio** for data-heavy surfaces: application shell clarity, spreadsheet-like tables, inline editing, filters, quick actions, record/context linking, and the AI composer.
- Use **Linear** for operational surfaces: hierarchy inside dense views, subdued application chrome, issue/task lists, contextual commands, keyboard-first navigation, bulk selection, side panels, and restrained state/motion feedback.
- Use **Collective OS** only for the presentation layer: light commercial tone, floating composition, soft depth, and a few elevated showcase modules. It is a demo, not evidence for production interaction behavior, accessibility, data density, error recovery, or responsive architecture.

The resulting product language should be “bright, precise, calm, and operational,” not a dashboard made of decorative cards and not a clone of Linear's dark theme.

## 2. Evidence and confidence labels

This document separates different kinds of evidence:

- **Confirmed** — described in a first-party help page, product article, changelog, or current downloadable application asset.
- **Observed** — visible in a first-party screenshot or the public Collective OS demo.
- **Inferred** — a measurement or design interpretation derived from screenshots/CSS. Treat inferred values as starting points, not brand facts.
- **Recommendation** — the proposed rule for Di Agent, informed by the references but owned by this product.

Important limitations:

1. Authenticated Attio and Linear workspaces are not public fixtures. Their official help centers, current app bundles, changelogs, and product screenshots are the primary evidence here.
2. Exact internal design-token names are implementation details and can change. The document records stable patterns before raw token values.
3. No primary source publishes a complete breakpoint map or motion-duration table for either product. Any such values below are explicitly marked as inferred or recommended.
4. Collective OS is a public demonstration. Its mock data and visible interactions do not establish production-grade behavior.

## 3. At-a-glance comparison

| Dimension | Collective OS demo | Attio | Linear | Di Agent use |
| --- | --- | --- | --- | --- |
| Role | Visual inspiration | Production data/workspace reference | Production task/agent workflow reference | Combine Attio structure with Linear hierarchy |
| Main visual idea | Light canvas, floating modules, commercial polish | White continuous workspace, spreadsheet precision, blue action accent | Quiet chrome, content-first hierarchy, compact controls | Bright shell, continuous work surfaces, sparing elevation |
| Navigation | Showcase composition | Persistent left sidebar with grouped objects, lists, chats | Inverted-L chrome, dimmer collapsible sidebar, compact tabs | Persistent but collapsible rail; content visibly dominant |
| Information density | Medium; intentionally staged | High in tables, medium in records/chat | High in lists, boards, issue panels, command surfaces | High where operational; comfortable in overview/home |
| Borders | Used to articulate floating blocks | Grid hairlines and control outlines | Fewer, softer separators after 2026 refresh | Hairlines for structure, shadows only for transient layers |
| Elevation | Important to the aesthetic | Mostly overlays/composer/modal | Mostly overlays/panels; main surfaces stay flat | One deliberate overlay scale, never “card soup” |
| Keyboard model | Not production evidence | Search `/`, quick actions `Cmd/Ctrl K`, direct creation keys | Extensive global and contextual shortcuts | Linear-like global command model with Attio-like search clarity |
| Responsive evidence | Demo-only | Separate mobile apps; desktop web is data-dense | Collapsible desktop sidebar; separate native mobile product | Desktop web first; 1440 → 1024 adaptive, not mobile compression |

---

## 4. Collective OS — visual inspiration only

### 4.1 What it is useful for

Collective OS is valuable as an art-direction reference:

- a light, presentation-friendly canvas;
- overlapping or floating modules that create depth without a dark “developer tool” mood;
- restrained commercial color, often with one strong accent and quiet neutrals;
- soft boundaries between editorial/overview content and operational modules;
- deliberate negative space around highlighted surfaces.

This is the right source for answering “how can the product feel premium and approachable?” It is not the right source for answering “how should filters, keyboard focus, loading, or destructive actions behave?”

Source boundary:

- **Observed, requested demo:** [collectiveos.vercel.app](https://collectiveos.vercel.app/).
- **Confirmed first-party public information architecture:** [Collective OS official site](https://joincollectiveos.com/), [How it works](https://joincollectiveos.com/how-it-works), [Why Collective](https://joincollectiveos.com/why-collective), [Case studies](https://joincollectiveos.com/case-studies), [Pricing](https://joincollectiveos.com/pricing), and the [official login entry](https://login.app.collective-os.com/).
- **Secondary code corroboration, not product truth:** A [public matching landing-page implementation](https://github.com/Leonxlnx/collective-os-landing/blob/main/index.html) closely matches the demo's Hero, navigation, metrics, and floating layers, but its lower-page content is older/different. Values derived from it are marked **code-corroborated**, not confirmed first-party tokens.

### 4.2 Page shell and composition

- **Observed:** The demo treats the viewport as a composed stage rather than a full-bleed enterprise grid. Large modules sit within generous outer whitespace.
- **Observed:** Visual grouping comes from relative position, scale, overlap, and elevation—not only from separators.
- **Inferred:** The layout is optimized for a controlled desktop scene and may use viewport-relative placement. That makes it visually strong but potentially brittle when real text, tables, permissions, and error states expand.
- **Recommendation:** Borrow the outer framing only for Home, onboarding, and lightweight overview surfaces. Operational pages should switch to Attio/Linear's continuous shell.
- **Observed:** A dark translucent capsule navigation floats roughly 24 px below the viewport top rather than spanning full width. It contains the logo, five compact links, login, and a white contact CTA.
- **Observed:** The Hero combines a very large two-line commercial headline with a product dashboard entering from the bottom of the first viewport. This “promise above, evidence below” composition is its most reusable idea.
- **Observed:** The dashboard mockup is a white dual-column shell: compact left navigation, top search/user toolbar, overview title, four KPI cards, and partially visible opportunity content. Glass-like status/opportunity modules overlap its boundary to produce the z-axis.
- **Code-corroborated:** The dashboard is capped around 1040 px wide, with an approximately 240 px sidebar and 580 px fixed height. Treat these as evidence for the mockup composition only—not Di Agent layout tokens.

### 4.3 Color, radius, border, and elevation

- **Observed:** Light neutral backgrounds and white modules carry most of the UI; accent color is used to create a clear focal point.
- **Observed:** Corners are visibly softer than those in a dense table product, and elevation is more pronounced than in Attio or Linear.
- **Inferred:** Medium-to-large radii and layered shadows are part of the demo's “commercial system” feel.
- **Recommendation:** Translate this into two named Di Agent surface types only:
  - `showcase-surface`: 14–18 px radius, soft shadow, used for Home/overview hero modules;
  - `work-surface`: 6–10 px radius or square continuous regions, hairline border, used for lists/tables/panels.
- **Code-corroborated:** The matching implementation uses `Plus Jakarta Sans`; its Hero scales from roughly 56 px to 88 px at the medium breakpoint, with 1.05 line-height, 800 weight, and `-0.03em` tracking. UI labels are around 10–13 px and body text around 15–18 px.
- **Code-corroborated:** The warm page background is `#F6F3EC`, with primary dark `#1C1A17`. Accent/status colors include turquoise `#4ECDC4`, iOS-like blue `#007AFF`, success `#10B981`, warning `#F59E0B`, and error `#EF4444`.
- **Code-corroborated:** Radius usage grows with component scale: about 12 px for navigation rows, 16 px for icon/list containers, 20 px for KPI/small floating cards, 24 px for dashboard internals, 32 px for the outer dashboard/feature cards, and 40 px for the largest CTA/graphic containers. Capsule controls use a full pill.
- **Code-corroborated:** Glass layers use a strong `0 24px 48px -12px rgba(0,0,0,.1)` shadow plus a white inner stroke; the navigation uses about `0 12px 32px rgba(0,0,0,.15)`; the dashboard shell uses about `0 40px 80px -20px rgba(0,0,0,.15)`. These are presentation shadows and are too strong for persistent work surfaces.

### 4.4 Motion and floating layers

- **Observed:** Floating presentation benefits from gentle entrance and position changes.
- **Recommendation:** Limit that treatment to first-load overview composition or an explicitly draggable utility panel. Do not animate every list row or table cell.
- **Recommendation:** Respect `prefers-reduced-motion`; preserve hierarchy when all decorative movement is removed.
- **Code-corroborated:** Scroll-reveal starts at opacity 0 and `translateY(40px)`, then runs for 900 ms with `cubic-bezier(0.16, 1, 0.3, 1)`; some elements use 100/200 ms stagger delays.
- **Code-corroborated:** Floating cards loop vertically by about 8–12 px over 5–7 seconds with ease-in-out timing. Buttons rise about 2 px; content cards about 4 px; one CTA scales to roughly 1.02.
- **Observed:** The demo exposes only a decorative dashboard search field and a Messages navigation entry. It does not expose search results, filters, command palette, full forms, chat composer, loading, empty, or error behavior. Those systems must come from Attio/Linear.

### 4.5 Responsive and accessibility observations

- **Code-corroborated:** The matching implementation uses Tailwind's common `sm` 640, `md` 768, and `lg` 1024 breakpoints. Below `md`, the navigation, dashboard sidebar, and most floating layers are hidden; KPI cards reduce to two columns. Below `lg`, the last language floating badge is also removed.
- **Observed/inferred:** This is a gracefully cropped landing-page demo, not a complete responsive Web app. Hiding navigation and overlap decoration is acceptable for a marketing mockup but not for Di Agent's 1024 px production mode.
- **Observed/code-corroborated accessibility gaps:** The search relies on a placeholder and removes the default outline; icon-only mail/notification controls lack visible labels; several pointer-like feature choices are non-button `div`s; FAQ state lacks explicit `aria-expanded`; the implementation has no reduced-motion branch; some 10–13 px gray copy is likely too low-contrast.
- **Recommendation:** Borrow no accessibility behavior from this demo. Use semantic controls, named icon buttons, visible `focus-visible`, reduced motion, real mobile/compact navigation, and AA contrast.

### 4.6 What not to copy

- Do not treat arbitrary content blocks as independent cards.
- Do not use overlap where content height is dynamic.
- Do not infer keyboard, focus, loading, error, or empty-state behavior from the demo.
- Do not preserve a staged hero composition at 1024 px if it forces unreadable content or horizontal collisions.
- Do not let soft shadows replace explicit selected/focus states.
- Do not copy the mock metrics, customer logos, portraits, brand gradient, or product claims; extract composition only.
- Do not treat its decorative search, Messages item, or blurred opportunity preview as evidence of a real search/chat/data system.
- Do not use fixed-height dashboard cropping or `overflow-x: hidden` to conceal real responsive failures.

**Source:** [Collective OS public demo](https://collectiveos.vercel.app/)

---

## 5. Attio — production reference for data and workspace UI

### 5.1 Design intent in one sentence

Attio makes a large, editable data model feel like a clean native workspace: white continuous surfaces, compact controls, high legibility, and color reserved for meaning and action.

### 5.2 Page shell

- **Confirmed:** Attio divides the workspace into a sidebar and a main panel. The sidebar contains Home, Search, notifications, Tasks, Notes, Emails, Calls, Reports, Sequences, Workflows, Favorites, Records, Lists, and Ask Attio Chats. The main panel owns the active dataset or object. [Introduction to navigating Attio](https://attio.com/help/reference/attio-101/introduction-to-navigating-attio)
- **Observed:** The sidebar is a continuous near-white region separated from the main panel with a single hairline. It is not presented as a floating card.
- **Observed:** Workspace identity and switching sit at the upper-left; the active object/list title and view controls sit at the top of the main panel.
- **Observed:** A second control row can appear under the title bar for view selection, settings, import/export, and the primary create action. A third, lighter row contains active sort/filter controls before the table header.
- **Recommendation:** Di Agent should mirror this layered header logic:
  1. global/product rail;
  2. page/location bar;
  3. optional view/filter bar;
  4. work surface.
  Each layer must have a distinct job.

Official current shell screenshot: [Attio sidebar and company table](https://a.storyblok.com/f/234930/626x921/27b93190df/attio-sidebar.png).

### 5.3 Navigation model

- **Confirmed:** Sidebar content is grouped by durable concepts (`Records`, `Lists`, `Chats`) rather than by every possible screen. Favorites can contain records, list views, dashboards, workflows, notes, and chats. [Navigating your workspace](https://attio.com/help/reference/productivity-collaborating/navigating-your-workspace)
- **Confirmed:** Favorites can be put in folders and reordered. List order can be Most relevant, Recently added, Alphabetical, or Custom.
- **Observed:** Top-level items use small monochrome line icons. Object/list identity may use compact colored icons or emoji. Section labels are lower contrast than navigable rows.
- **Observed:** The selected row uses a quiet light-gray full-width fill plus stronger text; it does not rely on saturated color.
- **Observed:** Row height is compact, with enough left/right padding to make scanning easy. The rail is dense because alignment is consistent, not because text is tiny.
- **Recommendation:** Di Agent should use the same three-tier distinction:
  - chrome/system actions: monochrome;
  - domain identity: a small semantic icon or avatar;
  - current location: neutral selected fill plus high-contrast label.

### 5.4 Typography

- **Confirmed from the current application HTML/assets:** Attio loads `InterVariable` and `InterVariable-Italic`; its current main CSS declares `Inter` for UI and `JetBrains Mono` for monospaced content. [Attio web app](https://app.attio.com/) and [current main stylesheet snapshot](https://app.attio.com/web-assets/main.bundle.733bf0994aae186b.css).
- **Observed:** Most workspace text is normal-weight sans serif. Weight changes, not large size jumps, establish the hierarchy between title, column label, row value, and metadata.
- **Confirmed from current CSS:** The bundle contains UI sizes from 10 through 32 px, with common sizes clustered at 12–16 px and line heights at 14, 16, 20, 24, and 28 px.
- **Inferred:** In the official table screenshots, row/cell text reads like 13–14 px; page/list titles like 16–20 px; large Home/Ask Attio greetings like 28–32 px.
- **Recommendation:** Use Inter (or Di Agent's chosen metric-compatible sans) with:
  - 12 px metadata/shortcut labels;
  - 13–14 px table and navigation text;
  - 15–16 px control emphasis/subhead;
  - 20–24 px work-page title;
  - 28–32 px Home/empty-state headline only.

### 5.5 Colors and themes

- **Confirmed:** Attio supports Light, Dark, and System themes and lets users choose an accent color. [Personalize Attio's appearance](https://attio.com/help/reference/account-settings/personalize-attios-appearance)
- **Observed:** The light theme is dominated by white and very light cool-neutral gray. Primary text is near-black; secondary text/icons are medium gray.
- **Observed:** Blue is the default high-salience action/focus/link color in official screenshots: the Add button, send button, links, mentions, and focus ring share the same family.
- **Observed:** Semantic field values use tinted pills—blue, cyan, pink, purple, green, yellow—whose pastel fill and darker text preserve legibility in a dense grid.
- **Recommendation:** Di Agent should keep one configurable product accent and a separate semantic palette. Never use the product accent as a substitute for warning/success/error colors.
- **Inferred:** A suitable light-mode starting palette is background `#F7F8FA`, surface `#FFFFFF`, primary text around `#242629`, secondary around `#6F737A`, hairline around black at 8–12% opacity, and default blue action around `#2F6FEB`. These are screenshot-based approximations, not Attio's published tokens.

### 5.6 Spacing, radii, borders, and elevation

- **Confirmed from current CSS:** Attio's application bundle contains 4, 5, 6, and 8 px gaps and an explicit radius scale including 0, 2, 4, 6, 8, 9, 10, 12, 14, 16, 20, 24, and 32 px. [Current main stylesheet snapshot](https://app.attio.com/web-assets/main.bundle.733bf0994aae186b.css)
- **Observed:** Dense controls and table affordances mostly use the low end of that scale (roughly 4–8 px). The AI composer and large containers use visibly larger radii (roughly 14–18 px).
- **Observed:** Main regions and tables are flat. One-pixel lines establish columns, rows, and bars. Shadows are concentrated on overlays, the AI composer, and popovers.
- **Confirmed from current CSS:** A common elevated treatment combines an inset 1 px border with very shallow `0 2px 4px -2px` and `0 3px 6px -2px` shadows; a stronger overlay token adds `0 4px 8px -4px` and `0 4px 12px -2px` shadows. This is evidence for restrained, layered elevation—not large blurred card shadows.
- **Recommendation:** Use a 4 px spacing base, with 6 px allowed for compact controls and 12/16/24/32 px for layout. Default control radius 6–8 px; popover 10–12 px; showcase/AI composer 14–16 px.

### 5.7 Tables, lists, and cards

- **Confirmed:** Attio table views are spreadsheet-style, with attributes as columns; users can filter, sort, edit inline, add/reorder/hide/resize columns, perform calculations, navigate cells with arrows, edit with Enter, and copy/paste data. [Create and manage table views](https://attio.com/help/reference/managing-your-data/views/create-and-manage-table-views)
- **Observed:** Table structure is continuous and edge-to-edge. There is no separate card around each row.
- **Observed:** The leading column contains a checkbox, avatar/icon, and linked primary label. Attribute headers pair a small type icon with the column name. Column borders are subtle but persistent.
- **Observed:** Select values are compact colored pills; stage values can be a colored dot plus text. Related people use avatars. This keeps data types visually distinguishable without thick cell backgrounds.
- **Observed:** The footer aligns per-column calculations with the grid; total count sits under the primary column.
- **Confirmed:** Kanban and table views share the same underlying list. Kanban cards can be dragged between stages; multi-select is available, and checkboxes appear on card hover. [Create lists](https://attio.com/help/reference/managing-your-data/lists/create-lists), [Manage lists](https://attio.com/help/reference/managing-your-data/lists/manage-lists)
- **Recommendation:** Di Agent tables should prioritize row and column alignment, sticky headers, inline editing, and horizontal overflow over responsive card conversion. Convert to cards only when the underlying task truly changes.

Official table screenshot: [Attio recruiting table](https://a.storyblok.com/f/234930/2458x1464/5353aa7243/recruiting-list.png).

### 5.8 Forms and inline editing

- **Confirmed:** Many values are edited directly in cells; column headers open formatting/settings menus. Record/list names can be edited in place.
- **Observed:** Form controls are usually outline-light, white or faint-gray surfaces with small icons and concise labels. The primary action is a filled blue button; secondary actions are neutral outlined controls.
- **Confirmed:** Table cell editing supports Enter/Return, arrow-key navigation, typed search within attribute options, and copy/paste.
- **Recommendation:** Prefer in-context editing when the field has a single obvious scope. Use a modal/drawer for multi-field creation, validation-heavy configuration, or destructive confirmation.
- **Recommendation:** Do not show every possible field by default. Follow Attio's progressive disclosure through View settings, column menus, and object settings.

### 5.9 Filters, sorting, and saved views

- **Confirmed:** Filter and sort controls sit at the top of the active view. Filters support multiple conditions and nested groups with AND/OR logic. Unsaved changes can be saved for everyone, saved as a new view, or discarded. [Filter and sort views](https://attio.com/help/reference/managing-your-data/views/filter-and-sort-views)
- **Confirmed:** Sorts can be layered and reordered. Linked relationship attributes can be displayed, filtered, and sorted.
- **Observed:** Applied sort is displayed as a compact descriptive control (`Sorted by …`); Filter remains a neighboring button. The current state is readable without reopening a panel.
- **Confirmed (May 2026):** Attio polished dropdowns to use fly-out menus for drill-down, made dropdowns modal so accidental outside clicks do not dismiss them, gave filter dropdowns clearer hierarchy, and made them reopen at the last selected level. [Attio changelog, 2026-05-28](https://attio.com/changelog/2026/changelog-may-28-2026)
- **Recommendation:** Preserve the distinction between temporary exploration and shared saved state. Di Agent must visibly indicate unsaved view changes and who will be affected by saving.

### 5.10 Search and quick actions

- **Confirmed:** `/` opens search; `Cmd/Ctrl K` opens contextual quick actions; direct creation shortcuts include `N` for note, `T` for task, and `C` for email. `?` opens help/shortcuts. [Navigating your workspace](https://attio.com/help/reference/productivity-collaborating/navigating-your-workspace)
- **Observed:** The quick-actions surface is a large centered modal. It has one prominent search input, uppercase group labels, left-aligned icon tiles, action labels, and right-aligned shortcut keycaps.
- **Observed:** The active row uses a full-width quiet gray highlight. A footer explains arrow navigation and shows the primary Enter action.
- **Recommendation:** Di Agent's command/search layer should adopt this visual legibility while using Linear's deeper contextual ranking. A command must remain discoverable by plain-language search even if it also has a shortcut.

Official screenshot: [Attio quick actions](https://a.storyblok.com/f/234930/1542x1086/a120f91917/quick-actions.png).

### 5.11 Ask Attio / chat surfaces

- **Confirmed:** Ask Attio can be opened from Home, the Chats section, quick actions, record pages, notes, all-records pages, calls, and the workflow editor. The context from which it is opened is prioritized. [Chat with Ask Attio](https://attio.com/help/reference/attio-ai/ask-attio/chat-with-ask-attio)
- **Observed:** The main composer is a large white rounded rectangle with a subtle border/shadow, generous typing area, and a compact bottom utility row.
- **Confirmed:** The composer supports `@` mentions, saved prompts via `/`, model selection via `Auto`, previous-conversation history, and a contextual item chip. The blue send button changes to a square stop control while generating.
- **Confirmed:** Messages can be edited; responses can be copied, retried, made more detailed/concise, or regenerated with another model. Edited/retried versions can be navigated with arrows.
- **Confirmed (May 2026):** Canceled or failed messages preserve whatever content has already streamed instead of disappearing. [Attio changelog, 2026-05-28](https://attio.com/changelog/2026/changelog-may-28-2026)
- **Recommendation:** Di Agent should copy the behavioral hierarchy, not the exact shape: one large composing focus, low-salience model/context controls, unmistakable send/stop state, preserved partial output, and explicit version/retry controls.
- **Recommendation:** Proposed changes that mutate data must remain reviewable before commit. Attio explicitly states that Ask Attio proposals to create/update/delete notes do nothing until confirmed.

Official screenshots: [Home composer](https://a.storyblok.com/f/234930/1920x1080/d5828a83d2/ask-attio-home-composer.png), [composer with mention](https://a.storyblok.com/f/234930/1920x782/be1f33e790/ask-attio-composer-mention.png), [generating/cancel control](https://a.storyblok.com/f/234930/1920x649/922fefecf3/ask-attio-cancel-message.png).

### 5.12 Interaction states

#### Hover

- **Confirmed/observed:** Hover reveals row/card checkboxes, star/favorite affordances, overflow menus, and AI autofill actions. The hover surface is a very light neutral tint.
- **Recommendation:** Reveal low-frequency controls on hover, but keep essential actions available by keyboard and touch-compatible focus states.

#### Focus

- **Observed:** Text/composer focus uses a thin blue outline/ring with no heavy glow.
- **Recommendation:** Use a 2 px visible focus ring for Di Agent even if visual reference rings appear thinner; accessibility takes precedence over pixel mimicry. Use `:focus-visible` and never remove the outline without a replacement.

#### Selected and bulk action

- **Confirmed:** Checkboxes support range and bulk selection; a bottom action bar appears for bulk operations.
- **Observed:** Selection uses checkbox state plus a quiet background, not color alone.

#### Loading

- **Confirmed from Attio's first-party SDK:** Loading surfaces use a spinner with optional explanatory text, defaulting to “Loading…”. In a dialog the loading state fills the dialog. [Attio LoadingState](https://docs.attio.com/sdk/components/loading-state)
- **Confirmed:** Attio's March 2026 Web research agent update explicitly mentions improved loading states. [Web research agent changelog](https://attio.com/changelog/2026/web-research-agent)
- **Recommendation:** Use skeletons for stable table geometry, a spinner for bounded actions, and streamed progress for agent work. Never replace an entire stable shell with a blank spinner.

#### Empty

- **Confirmed from Attio's first-party SDK:** Dialog lists require an empty-state message and may include actions. [Attio DialogList](https://docs.attio.com/sdk/dialogs/dialog-list)
- **Recommendation:** Every Di Agent empty state should state why it is empty and offer one relevant next action; filtering emptiness must include “clear filters.”

#### Error

- **Confirmed:** CSV import progress shows a green check on success and a red error icon on failure; hovering the error reveals a description, and status filters separate Failed, Planned, and Completed. [Import data into Attio](https://attio.com/help/reference/imports-exports/csv-imports/import-data-into-attio-via-csv)
- **Confirmed:** Broadcast messages use semantic icons/colors for Error, Neutral, Success, and Warning. [Attio workflow block library](https://attio.com/help/reference/automations/legacy-workflows/legacy-workflows-block-library)
- **Recommendation:** Preserve successful rows when some fail, attach error detail to the affected item, and provide retry/remediation instead of a generic page-level toast.

### 5.13 Motion

- **Confirmed behavior:** Drag-and-drop, inline cell changes, fly-out menus, and streamed Ask Attio output are core motion contexts.
- **Observed:** The official interface relies on direct state changes and small overlay transitions, not decorative page transitions.
- **No confirmed duration:** Attio does not publish a public motion-duration scale in the reviewed sources.
- **Recommendation:** 120–160 ms for hover/focus/color; 160–220 ms for popovers; 220–280 ms for drawers; spring/drag feedback only during direct manipulation. Disable nonessential transforms under reduced motion.

### 5.14 Responsive behavior

- **Confirmed:** Attio offers distinct iOS/Android mobile apps and a desktop app in addition to the web app. [Attio tools and extensions](https://attio.com/help/reference/attio-apps)
- **No confirmed breakpoint:** The reviewed first-party sources do not publish exact web breakpoints.
- **Observed:** Desktop tables assume horizontal space and preserve columns. That is evidence against squeezing every column into a narrow card.
- **Recommendation for Di Agent:**
  - at 1440+: full rail, full page title/actions, optional right panel;
  - 1200–1439: slightly narrower rail and control labels, right panel overlay or resizable;
  - 1024–1199: collapsible rail, secondary actions in overflow, table keeps horizontal scroll, detail panel becomes overlay;
  - below 1024: maintain basic accessibility but do not promise full mobile parity in this phase.

### 5.15 Accessibility strengths and gaps

Strengths to copy:

- keyboard shortcuts plus visible shortcut discovery;
- arrow-key and Enter navigation inside tables;
- text/icons in addition to semantic color;
- light/dark/system themes and configurable accent;
- action-specific error markers and descriptions;
- confirmation before AI-proposed mutations.

Do not assume from the screenshots:

- that every gray-on-white combination meets WCAG AA;
- that hover-only controls are keyboard discoverable;
- that a 1 px decorative focus border is sufficient.

Di Agent must explicitly validate contrast, focus order, semantic table markup, reduced motion, and 200% zoom.

### 5.16 What not to copy from Attio

- Do not reproduce the whole CRM ontology if Di Agent's domain is tasks/agents/projects.
- Do not place every action in a pill-shaped button; Attio's density works because many controls are plain rows or grid cells.
- Do not rely on pastel pill color without text.
- Do not make every filter/save operation globally shared by default; scope must be explicit.
- Do not reuse an enormous AI composer on every page. Use it where the user is genuinely composing or asking.
- Do not blindly copy hashed CSS tokens; copy the scale and hierarchy.

---

## 6. Linear — production reference for operational and agent workflows

### 6.1 Design intent in one sentence

Linear keeps dense operational work fast by making the current task visually strongest and pushing navigation, metadata, and infrequent actions into quieter layers that remain keyboard-accessible.

### 6.2 Current-version caveat

Linear shipped a major redesign in 2024 and another interface refresh on 2026-03-12. The 2026 refresh is the current visual authority; the 2024 article remains valuable for the underlying theme architecture, typography decisions, and cross-platform reasoning. [2026 UI refresh](https://linear.app/changelog/2026-03-12-ui-refresh), [2026 design article](https://linear.app/now/behind-the-latest-design-refresh), [2024 redesign article](https://linear.app/now/how-we-redesigned-the-linear-ui).

### 6.3 Page shell

- **Confirmed:** Linear calls the global shell an inverted L: the top chrome plus left sidebar frame the active content.
- **Confirmed (2026):** Headers, navigation, and view controls were standardized across projects, issues, reviews, and documents.
- **Confirmed:** Additional view headers contain filters/display options; side panels contain metadata; content can switch among list, board, timeline, split, and fullscreen layouts.
- **Observed:** The content region uses a slightly stronger surface/contrast than the surrounding chrome. The shell recedes once the user arrives at a work view.
- **Recommendation:** Di Agent should make global chrome stable and modest, while allowing page-specific view bars and right-side task/agent inspectors.

### 6.4 Navigation

- **Confirmed (2026):** The sidebar was made dimmer, with smaller refined icons, more vertical padding, and more-muted inactive labels, so the main content remains dominant.
- **Confirmed:** Top desktop tabs became more compact, gained rounded corners, and use smaller icon/text sizing; some tabs collapse to icon-only items.
- **Confirmed:** The sidebar can fully collapse using `[`, a border click, or the command menu, and can expand through the same mechanisms. [Collapsible sidebar](https://linear.app/changelog/unpublished-collapsible-sidebar)
- **Confirmed:** Favorites are personal, can be organized into folders, and are accessible from the sidebar or `O` then `F`. [Favorites](https://linear.app/docs/favorites)
- **Observed:** Active navigation uses a quiet rounded fill; inactive items may be substantially dimmed in dark mode. The selected item is readable from position, icon, text contrast, and surface—not accent color alone.
- **Recommendation:** Use dimming sparingly in Di Agent's light theme. Inactive items must remain comfortably readable, especially at 1024 px and low-quality displays.

Current official comparisons: [sidebar before/after](https://webassets.linear.app/images/ornj730p/production/b6d6be14c96978b10553cfb9205be1065087e793-3904x2720.png?auto=format&dpr=2&q=95), [compact tabs](https://webassets.linear.app/images/ornj730p/production/51c8d03e31853bae9491d8ac5f05bdf1d7921236-3904x2160.png?auto=format&dpr=2&q=95).

### 6.5 Typography

- **Confirmed from the current application HTML/assets:** Linear loads `InterVariable`; the current application CSS declares `Inter Variable` as the regular UI family and `Berkeley Mono` as the preferred monospace. [Linear login/app entry](https://linear.app/login), [current application stylesheet snapshot](https://static.linear.app/client/assets/style-B8GKlqD1.css)
- **Confirmed (2024 redesign):** Linear introduced Inter Display for expressive headings while keeping regular Inter for other text at that time.
- **Confirmed from current CSS:** Common explicit UI font sizes cluster around 10, 11, 12, 14, 15, and 20 px, with 32 px available for larger display contexts; common line heights include 14, 16, 18, 20, 22, 24, 28, and 32 px.
- **Observed:** Dense list labels often feel one step smaller than Attio's table text, but stronger contrast and precise alignment preserve scan speed.
- **Recommendation:** Do not chase Linear's smallest sizes. For Di Agent Web, keep the operational floor at 12 px for metadata and 13–14 px for primary row content.

### 6.6 Color and theming

- **Confirmed (2024):** Linear's theme generation uses three inputs—base color, accent color, and contrast—and uses LCH-based generation for its main light/dark themes and surface elevations. A high-contrast setting can be generated for accessibility.
- **Confirmed (2026):** The default palette moved from cool blue-gray toward a warmer, less saturated gray while staying crisp.
- **Confirmed (2026):** Sidebar chrome became visually quieter than content.
- **Observed:** Saturated color is concentrated in semantic icons, status dots, priority symbols, avatars, and primary actions. Large surfaces remain neutral.
- **Recommendation:** Di Agent should use warm neutral light surfaces with a teal/blue product accent, but retain separate status hues. Allow a contrast preference before allowing arbitrary theme complexity.

### 6.7 Spacing, radii, borders, and elevation

- **Confirmed (2026):** The refresh added vertical padding in the sidebar while making icons smaller. This is a reminder that “compact” does not mean every dimension shrinks.
- **Confirmed (2026):** Borders were reduced, softened in contrast, and given more rounded endings/containers so structure is felt rather than constantly drawn.
- **Confirmed from current CSS:** A 1 px focus-ring width is defined in the current app bundle. Common component radii include 5, 6, and 7 px, with 10–12 px and larger values used for bigger panels/pills.
- **Observed:** Permanent surfaces are mostly flat. Popovers/dialogs use subtle outline plus shadow; selected navigation/tabs use surface contrast.
- **Recommendation:** Di Agent should use 1 px structural borders and a stronger 2 px `focus-visible` ring. Default dense radius 6 px; toolbar/button 7–8 px; popover/dialog 10–12 px; full pill only for tags, toggles, and compact tabs.

Official comparison: [softer borders and fewer separators](https://webassets.linear.app/images/ornj730p/production/67561baa677fbc429d94edd080e95aecabb6bae2-3904x2720.png?auto=format&dpr=2&q=95).

### 6.8 Lists, boards, tables, and bulk actions

- **Confirmed:** Nearly all issue views can switch between list and board (`Cmd/Ctrl B`). The same selection and keyboard behaviors largely apply to both. [Board layout](https://linear.app/docs/board-layout)
- **Confirmed:** Board views support grouped columns/swimlanes, collapsible groups, hidden columns, drag-and-drop, and a `+` at the top of a column for creation.
- **Confirmed:** Hover highlights an issue; `↑/↓` or `J/K` changes the highlighted issue. `X`, Shift-click, and range keyboard operations select issues. A bulk action bar appears at the bottom. [Select issues](https://linear.app/docs/select-issues)
- **Observed:** Issue rows/cards place status/priority/team identity first, then the concise title, then quiet metadata. The visual system is optimized for scanning before reading.
- **Recommendation:** Di Agent task rows should be one primary sentence plus compact status/owner/progress metadata. Long descriptions belong in the inspector, not the row.
- **Recommendation:** Preserve the same selection model across list and board, and keep bulk actions spatially stable at the bottom.

### 6.9 Issue/detail and side-panel surfaces

- **Confirmed:** Linear supports right-hand view sidebars for metadata and quick filtering; issue relations and duplicate status get dedicated sidebar/banner treatments. [Custom views](https://linear.app/docs/custom-views), [Issue relations](https://linear.app/docs/issue-relations)
- **Confirmed:** Side panels coexist with list/board/timeline/split/fullscreen modes.
- **Observed:** The inspector feels integrated into the main canvas through shared surfaces and subtle separators, not a floating white card on top of the page.
- **Recommendation:** Di Agent's task/agent detail should be a docked, resizable inspector at wide widths and an overlay at narrow widths. Use floating windows only for explicitly movable utilities such as task progress.

### 6.10 Filters, display options, and saved views

- **Confirmed:** `F` opens filters; views accept multiple filters. Advanced filters support nested AND/OR groups. Filtered state updates the issue list and main filters are reflected in the URL. [Filters](https://linear.app/docs/filters)
- **Confirmed:** Natural-language AI filtering can translate a phrase into suitable parameters. Quick-search filters let users type property values directly.
- **Confirmed:** `Shift V` opens Display options; users can switch layout, group, order, and choose visible information. Display choices can be personal or workspace defaults. [Display options](https://linear.app/docs/display-options)
- **Confirmed:** Filtered list/board states can be saved as reusable custom views with `Alt/Option V`; views can be favorited and shared. [Custom views](https://linear.app/docs/custom-views)
- **Observed:** Current 2026 controls prefer a compact textual `Filter` and `Display` row with fewer unnecessary icon-only separators.
- **Recommendation:** Di Agent should keep `Filter`, `Display`, and `Save view` conceptually separate. Filtering chooses records; display changes their projection; saving determines persistence/scope.

### 6.11 Search and command menu

- **Confirmed:** `/` opens workspace search; `Cmd/Ctrl F` searches the current view; `O` then `I` finds recent issues or searches by issue ID/title. Prefixes (`i`, `p`, `u`, `t`, `l`, `f`, `d`) scope results. [Search](https://linear.app/docs/search)
- **Confirmed:** Search can use `@` mentions as structured filters and highlights matching terms.
- **Confirmed:** The command menu groups commands by functionality and prioritizes groups according to the current view/selection. [New command menu](https://linear.app/changelog/2019-12-18-new-command-menu)
- **Confirmed:** When invoked by mouse from a property/control, the contextual command menu is positioned close to that element like a dropdown while remaining searchable and keyboard-controllable. [Contextual command menu](https://linear.app/changelog/2019-10-07-contextual-command-menu)
- **Recommendation:** Di Agent should have one command infrastructure with two presentations:
  - centered global search/command palette for keyboard invocation;
  - anchored contextual menu for mouse invocation.
  The same action model should power both.

### 6.12 Forms and creation

- **Confirmed:** `C` opens issue creation in a modal; `V` creates in fullscreen; `Alt/Option C` applies a template. [Create issues](https://linear.app/docs/creating-issues)
- **Confirmed:** Navigating away temporarily hides the modal and keeps a local draft. Closing with Esc/close asks whether to save the draft; saved drafts persist across clients.
- **Observed:** Creation keeps title and description central, while team/status/assignee/project properties are compact contextual controls.
- **Recommendation:** Di Agent creation should preserve drafts, allow modal-to-fullscreen escalation, and avoid losing typed content when navigating. Do not show a 20-field creation form up front.

### 6.13 Agent/chat-like surfaces

- **Confirmed (current 2026 changelog):** `Cmd/Ctrl J` opens Linear Agent. Agent sessions can appear in sidebars; views such as My Issues, Inbox, Reviews, Pulse, and team views can be included as context. [Linear changelog page 2](https://linear.app/changelog/page/2)
- **Confirmed:** An animated desktop tab indicator can show when a coding agent is actively working.
- **Confirmed:** Agent chats can be copied as Markdown; file drag-and-drop is supported; expanding agent thoughts and agent panel focus behavior have received dedicated motion/focus fixes.
- **Observed:** Agent UI is integrated into the existing issue/workspace frame instead of becoming a separate “AI app” visual language.
- **Recommendation:** Di Agent should make agent activity a normal operational state: attach it to the task, show running/attention/completed status in tabs and lists, and open detail in the existing inspector. Avoid neon gradients or a separate sci-fi chrome.

### 6.14 Interaction states

#### Hover and keyboard highlight

- **Confirmed:** Hover or `J/K` highlights an issue. Hover near the leading edge reveals a checkbox. Current changelog notes that sidebar hover changes are instant.
- **Recommendation:** Use immediate color/opacity changes for high-frequency row hover; avoid translating/lifting rows.

#### Focus

- **Confirmed:** The current bundle defines a 1 px focus-ring width; current changelog includes explicit sidebar focus-ring fixes. [Current Linear stylesheet](https://static.linear.app/client/assets/style-B8GKlqD1.css), [Linear changelog page 1](https://linear.app/changelog/page/1)
- **Recommendation:** Increase to a clearly visible 2 px ring in Di Agent where necessary, with a color that meets contrast against both selected and default surfaces.

#### Selected

- **Confirmed:** Selection is distinct from hover/highlight and enables bottom bulk actions. Esc clears selection.
- **Recommendation:** Preserve separate tokens for hover, keyboard-highlight, selected, and active/current. Collapsing them into one gray fill creates ambiguity.

#### Loading

- **Confirmed:** Linear has historically tried to minimize loading states; initial load uses a subtle logo animation. Recent changelogs mention more performant loading icons and fixes for layout shifts/blank frames. [First-time user experience](https://linear.app/changelog/2019-05-09-first-time-user-experience)
- **Recommendation:** Keep the shell and last known data stable, reserve animation for the bounded element, and prevent geometry shift as agent sessions or panels load.

#### Empty

- **Confirmed:** Linear's changelog records actionable empty-state buttons such as `Add request`; it also distinguishes an actual system limit/error from an empty result—for example, boards now show an error rather than an empty state when too many issues match. [Linear changelog page 2](https://linear.app/changelog/page/2), [page 1](https://linear.app/changelog/page/1)
- **Recommendation:** Empty state = no data; zero-result state = no match; error state = failed/limited. Never reuse the same illustration/message for all three.

#### Error

- **Confirmed:** Linear continually replaces generic or false confirmations with clearer errors and preserves context where possible.
- **Recommendation:** Put errors next to the failed action/row/panel, keep the user's draft, and provide retry or a clear next step.

### 6.15 Motion

- **Confirmed:** The 2026 product uses animation for active agent tab indication and loading; current changelogs specifically fix choppy agent-thought animation and make sidebar hover instantaneous.
- **Observed:** Navigation, selection, and list scanning rely mostly on immediate state changes; motion is used to explain working/expanding/opening, not to decorate.
- **No confirmed duration:** Linear does not publish a complete current duration/easing scale in the reviewed sources.
- **Recommendation:** Make list hover/keyboard highlight instantaneous or ≤100 ms; controls 120–160 ms; popovers 160–200 ms; drawers/panels 200–260 ms. Active-agent animation should be low-amplitude and stop or simplify under reduced motion.

### 6.16 Responsive and cross-platform behavior

- **Confirmed:** Linear deliberately tested the shell across macOS, Windows, Electron, and the browser, with removable desktop-only history/tab affordances. [2024 redesign article](https://linear.app/now/how-we-redesigned-the-linear-ui)
- **Confirmed:** The desktop sidebar fully collapses, and current changelogs include narrow-window and collapsed-sidebar fixes.
- **Confirmed:** Linear ships a separate native mobile experience optimized for away-from-keyboard workflows, rather than presenting mobile as a shrunken desktop board. [Introducing Linear Mobile](https://linear.app/changelog/2024-09-19-introducing-linear-mobile)
- **Recommendation:** For Di Agent Web, treat 1024 px as a compact desktop mode:
  - collapse the global rail;
  - keep the active view toolbar readable;
  - move right-side metadata/agent panels into overlays;
  - preserve horizontal tables/boards;
  - do not attempt full phone parity in this phase.

### 6.17 Accessibility strengths and gaps

Strengths to copy:

- deep keyboard coverage, including visible searchable shortcut help;
- equivalent mouse, keyboard, and command-menu paths;
- user-adjustable theme contrast, including high-contrast generation;
- selected/hover states that also use position, surface, text, and icon—not color alone;
- explicit focus-ring maintenance and non-US keyboard-layout fixes;
- standard OS/browser behavior considered across web and desktop.

Requirements Di Agent must add or verify explicitly:

- WCAG AA contrast in the light theme, especially muted chrome;
- semantic row/button/checkbox structure without nested interactive roles;
- announced agent running/progress/completed/error status;
- reduced-motion fallback for active agent indicators;
- 200% zoom and keyboard-only operation at 1024 CSS px.

### 6.18 What not to copy from Linear

- Do not make the entire product dark or blue-gray; the requested direction is bright Web.
- Do not dim inactive navigation so far that discoverability or contrast suffers.
- Do not import Linear's issue-tracker vocabulary into unrelated Di Agent objects.
- Do not copy the extreme keyboard density without searchable help and mouse equivalents.
- Do not use icon-only tabs where labels are still unfamiliar.
- Do not hide critical actions solely in the command menu.
- Do not mimic tiny text just to look “dense.”

---

## 7. Cross-reference blueprint for Di Agent

### 7.1 Shell

```text
┌────────────────────────────────────────────────────────────────────┐
│ Global rail │ Location / tabs / global actions                     │
│             ├──────────────────────────────────────────────────────┤
│             │ View title │ Filter │ Display │ … │ Primary action   │
│             ├───────────────────────────────────┬──────────────────┤
│             │ Main list / board / table          │ Detail / Agent   │
│             │                                    │ inspector        │
│             │                                    │ (dock or overlay)│
└─────────────┴───────────────────────────────────┴──────────────────┘
```

- Attio supplies the grouped rail and layered view controls.
- Linear supplies the quiet inverted-L hierarchy, collapsible rail, compact tabs, and docked inspector.
- Collective OS supplies soft light framing for Home and selected overview modules only.

### 7.2 Surface rules

| Surface | Treatment | Reference |
| --- | --- | --- |
| Global rail | Continuous neutral surface, 1 px divider | Attio + Linear |
| Main work canvas | Flat warm white, minimal separators | Linear 2026 |
| Table/list | Continuous grid/list; no row cards | Attio |
| Task board card | Small radius, border-led, no idle shadow | Linear |
| Record/task inspector | Docked surface; overlay at compact width | Linear |
| Command palette | Centered, searchable, selected row, shortcut hints | Attio visual + Linear logic |
| Context menu | Anchored to trigger, searchable when deep | Linear |
| AI composer | Large focusable input, subtle elevation, context/model footer | Attio |
| Movable progress window | Explicit floating utility with one restrained shadow | Collective mood + production constraints |
| Home/overview module | Optional showcase radius/shadow | Collective only |

### 7.3 Proposed foundation tokens

These are **Di Agent recommendations**, not copied brand tokens.

```css
:root {
  --font-ui: Inter, ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Berkeley Mono", ui-monospace, monospace;

  --space-1: 4px;
  --space-1-5: 6px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;

  --radius-control: 7px;
  --radius-panel: 10px;
  --radius-overlay: 12px;
  --radius-showcase: 16px;
  --radius-pill: 999px;

  --bg-app: #f5f6f4;
  --bg-canvas: #fafaf8;
  --bg-surface: #ffffff;
  --bg-hover: rgba(25, 28, 33, 0.045);
  --bg-selected: rgba(15, 118, 110, 0.10);
  --text-primary: #242624;
  --text-secondary: #6e716d;
  --text-muted: #92958f;
  --border-subtle: rgba(26, 31, 28, 0.10);
  --accent: #0f766e;
  --focus: #2563eb;

  --shadow-overlay:
    0 0 0 1px rgba(24, 41, 75, 0.06),
    0 4px 8px -4px rgba(24, 41, 75, 0.16),
    0 8px 20px -8px rgba(24, 41, 75, 0.14);
}
```

### 7.4 State contract

Every interactive component must define all of these states before implementation:

| State | Required visible signal | Notes |
| --- | --- | --- |
| Default | Label/icon and stable hit area | No hover dependency |
| Hover | Subtle fill or contrast shift | No layout movement |
| Keyboard highlight | Distinct row highlight | Used by J/K/arrow navigation |
| Focus-visible | 2 px ring with sufficient contrast | Must coexist with selected state |
| Selected | Checkbox/marker + surface | Never color only |
| Active/current | Stronger label and location indicator | Different from selected-for-bulk |
| Pressed | Immediate local feedback | Avoid scale on dense rows |
| Disabled | Reduced contrast + unavailable semantics | Explain reason when non-obvious |
| Loading | Preserve geometry; local spinner/skeleton/progress | Announce status |
| Empty | Reason + one useful action | Filter-empty offers clear filters |
| Error | Attached message/icon + recovery | Preserve drafts/partial output |
| Success | Quiet confirmation or row update | Avoid blocking modal for routine success |

### 7.5 Motion contract

- Color/opacity for hover and focus: 0–140 ms.
- Menus/popovers: 160–200 ms, opacity plus ≤4 px movement.
- Drawers/inspectors: 200–260 ms ease-out.
- Drag/resizing: direct 1:1 tracking; no delayed spring while pointer is down.
- Agent activity: subtle continuous indicator only while work is active.
- Reduced motion: remove travel/parallax/continuous pulse; preserve state via text/icon/progress value.

### 7.6 Responsive contract for Web phase

| Width | Shell | Work surface | Inspector/overlays |
| --- | --- | --- | --- |
| ≥1440 | Full rail, labels, tabs, full action row | Multi-column tables/boards | Docked and resizable |
| 1200–1439 | Slightly reduced rail and gaps | Preserve density; trim optional columns | Docked if space remains |
| 1024–1199 | Collapsible/icon rail; secondary actions in overflow | Horizontal scroll, no semantic card conversion | Overlay/drawer |
| <1024 | Basic access only in current scope | Prioritize one work surface | Full-width overlay; no promise of full parity |

Implementation guardrails:

- Do not set a fixed 1440 px canvas width.
- Use CSS grid/minmax and container queries for local adaptation.
- Keep table columns intrinsically sized and horizontally scrollable.
- Never hide the page title, primary action, filter state, or running-agent status.
- Validate at 1440×900, 1280×800, 1024×768, 200% zoom, and with the rail/inspector both open and closed.

---

## 8. Detailed “copy / adapt / avoid” list

### Copy directly as behavior

- Attio's layered page/view/filter hierarchy.
- Attio's inline table editing and spreadsheet keyboard behavior.
- Attio's distinction between temporary filter changes, save for everyone, save as new view, and discard.
- Attio's Ask composer send→stop transition and preservation of partial failed/canceled output.
- Linear's separate hover, keyboard-highlight, selected, and current states.
- Linear's same selection/shortcut model across list and board.
- Linear's contextual command logic and searchable global palette.
- Linear's draft preservation and modal/fullscreen creation options.
- Linear's collapsible rail and narrow-width inspector adaptation.
- Both products' use of a bottom bulk-action surface.

### Adapt visually

- Attio's white/blue look → Di Agent warm white/teal with blue reserved for focus/link if desired.
- Linear's dark examples → bright theme with the same hierarchy and muted chrome.
- Collective OS elevation → only Home/showcase modules and the movable progress utility.
- Linear's very small UI text → a safer 12 px minimum metadata and 13–14 px primary rows.
- Attio's large AI composer → size according to actual task, with a compact variant for docked inspectors.

### Avoid

- card-per-section dashboard layouts;
- nested pill groups around every toolbar control;
- icon-only navigation before users know the icons;
- long-lived shadows on tables and lists;
- gray text that is “premium” but unreadable;
- hover-only essential actions;
- overwriting shared views without explicit scope;
- clearing partial agent output on cancel/error;
- changing table semantics into cards merely to fit 1024 px;
- relying on a demo to define production behavior.

---

## 9. Primary-source index

### Collective OS

- [Collective OS public demo](https://collectiveos.vercel.app/)

### Attio

- [Attio web app entry and current assets](https://app.attio.com/)
- [Navigating your workspace](https://attio.com/help/reference/productivity-collaborating/navigating-your-workspace)
- [Introduction to navigating Attio](https://attio.com/help/reference/attio-101/introduction-to-navigating-attio)
- [Create and manage table views](https://attio.com/help/reference/managing-your-data/views/create-and-manage-table-views)
- [Filter and sort views](https://attio.com/help/reference/managing-your-data/views/filter-and-sort-views)
- [Create lists](https://attio.com/help/reference/managing-your-data/lists/create-lists)
- [Manage lists](https://attio.com/help/reference/managing-your-data/lists/manage-lists)
- [Chat with Ask Attio](https://attio.com/help/reference/attio-ai/ask-attio/chat-with-ask-attio)
- [Personalize Attio's appearance](https://attio.com/help/reference/account-settings/personalize-attios-appearance)
- [Import data into Attio](https://attio.com/help/reference/imports-exports/csv-imports/import-data-into-attio-via-csv)
- [Attio changelog, 2026-05-28](https://attio.com/changelog/2026/changelog-may-28-2026)
- [Web research agent changelog](https://attio.com/changelog/2026/web-research-agent)
- [Attio first-party SDK LoadingState](https://docs.attio.com/sdk/components/loading-state)
- [Attio first-party SDK DialogList](https://docs.attio.com/sdk/dialogs/dialog-list)
- [Attio tools and extensions](https://attio.com/help/reference/attio-apps)

### Linear

- [Linear 2026 UI refresh changelog](https://linear.app/changelog/2026-03-12-ui-refresh)
- [A calmer interface for a product in motion (2026)](https://linear.app/now/behind-the-latest-design-refresh)
- [How we redesigned the Linear UI, part II (2024)](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Welcome to the new Linear (2024)](https://linear.app/changelog/2024-03-20-new-linear-ui)
- [Filters](https://linear.app/docs/filters)
- [Display options](https://linear.app/docs/display-options)
- [Search](https://linear.app/docs/search)
- [Custom views](https://linear.app/docs/custom-views)
- [Board layout](https://linear.app/docs/board-layout)
- [Select issues](https://linear.app/docs/select-issues)
- [Create issues](https://linear.app/docs/creating-issues)
- [Favorites](https://linear.app/docs/favorites)
- [Collapsible sidebar](https://linear.app/changelog/unpublished-collapsible-sidebar)
- [New command menu](https://linear.app/changelog/2019-12-18-new-command-menu)
- [Contextual command menu](https://linear.app/changelog/2019-10-07-contextual-command-menu)
- [Introducing Linear Mobile](https://linear.app/changelog/2024-09-19-introducing-linear-mobile)
- [Current Linear changelog, page 1](https://linear.app/changelog/page/1)
- [Current Linear changelog, page 2](https://linear.app/changelog/page/2)
- [Current Linear application stylesheet snapshot](https://static.linear.app/client/assets/style-B8GKlqD1.css)

## 10. Bottom line

The strongest Di Agent design is not “Collective OS versus Attio versus Linear.” It is a controlled division of labor:

- **Collective OS** sets the light, premium emotional tone in a few overview moments.
- **Attio** defines how data, search, filters, editable tables, and AI context behave.
- **Linear** defines how tasks, agents, selection, commands, panels, and dense operational states behave.

When a design choice affects correctness, discoverability, responsiveness, accessibility, or recovery, Attio/Linear production evidence must override the Collective OS demo aesthetic.

<!-- Generated from @corbits/react-ui 0.5.0. Regenerate: bun scripts/react-ui-api.ts -->

# react-ui: app shell and page layout (0.5.0)

Props per exported component, from the installed declarations. `?` marks optional. `+native` means the component also accepts the native props of the element it renders (`className`, `onClick`, ...). Import from the package root unless SKILL.md lists the module as a subpath.

## ui/boot-screen

### BootScreen — The screen before the app: brand top-left, one centered status line, a quiet corner detail.
message: string — What the app is doing, in words: "Loading workbench", "Reconnecting…".
brand?: ReactNode — Brand lockup, top left.
footer?: ReactNode — Quiet corner detail — a version string, a build id.
className?: string

## ui/card

### Card +native

### CardHeader +native

### CardTitle +native

### CardDescription +native

### CardFooter +native

## ui/corbits-mark

### CorbitsMark
title?: string — Accessible name.
decorative?: boolean — The mark is beside text that already says the name.
className?: string

### CORBITS_MARK_PATH — The Corbits mountain mark.

### CORBITS_MARK_VIEWBOX — The mark's viewBox, exported so non-SVG consumers can map path space to pixels.

## ui/inspector-shell

### InspectorEmpty — The "nothing selected" message inside an inspector rail.
title: string
description?: string
className?: string

### InspectorHeader — The chip row, title and action buttons at the top of an inspector.
eyebrow?: ReactNode
title: ReactNode
description?: ReactNode
actions?: ReactNode
className?: string

### InspectorPanelTitle
children: ReactNode
className?: string

### InspectorKv
rows: readonly InspectorKvRow[]
className?: string

### InspectorShell — The side-rail frame every inspector shares: a header region, a scrollable body, and an empty state that replaces both when there is no selection.
header?: ReactNode
children?: ReactNode
empty?: ReactNode — Shown instead of `children` when nothing is selected.
className?: string

## ui/kind-card-grid

### KindCardGrid — Selectable card grid for channel-kind, grant-effect, provider, and workbench-type pickers.
options: readonly KindCardOption[]
value?: string
onChange?: ((id: string) => void)
label: string — Accessible name for the radiogroup.
columns?: 2 | 3 | 4
className?: string

## ui/library-page-header

### LibraryPageHeader — The header row every library page shares: title, item count, then trailing controls after a flexible spacer.
title: string
titleSize?: "sm" | "lg" — `lg` (21px, default) for catalog pages; `sm` (17px) for denser lists.
count?: number — When provided, renders an "{count} items" chip beside the title.
subtitle?: string — One line under the title — what this library holds.
children?: ReactNode — Trailing controls: search, view toggle, action buttons.
className?: string

## ui/list-detail

### ListDetail — Index on the left, the open item on the right.
list: ReactNode — The index: a catalog grid, a table, a list of skills or tools.
detail: ReactNode — The open item.
onCloseDetail: () => void — Clears the selection.
placeholder?: ReactNode — Shown on wide screens when nothing is selected.
detailLabel?: string
className?: string

## ui/notifications-bell

### NotificationsBell — Bell + count, with the panel body as a slot.
count: number — Unread count.
children: ReactNode — Panel contents — a notification list, an empty state, whatever the host has.
maxCount?: number — Counts above this render as "N+" so the marker cannot grow unbounded.
open?: boolean — Controlled open state.
onOpenChange?: ((open: boolean) => void)
className?: string

## ui/now-cards

### NowSection — The attention band at the top of the inbox.
count: number — How many things are asking for attention — drives the count sentence.
collapsed?: boolean — Tucks the body away and leaves a one-line summary.
children: ReactNode
className?: string

### NowCards — The highest-attention items as cards.
items: readonly NowItem[]
limit?: number — Cap on cards shown.
selectedId?: string | null
now?: number
className?: string

## ui/page-panel

### PagePanel — The standard page-content frame: a full-height outer fill plus a bordered panel that owns the page's vertical scroll.
children: ReactNode
scroll?: boolean — When true the inner panel scrolls vertically; when false it clips overflow and leaves scrolling to its own children (e.g a header + scroll body).
flat?: boolean — Drop the panel's shadow — some surfaces render flatter.
fitContent?: boolean — Size the panel to its content instead of filling the viewport.
surface?: "background" | "card" — Fill token for the outer bleed and the panel itself.
className?: string

## ui/page-shell

### PageShell +native — The frame a top-level page sits in: full height, one scroll container, and a consistent measure.
scroll?: boolean — The shell owns the vertical scroll.
width?: "prose" | "wide" | "full" — Caps and centres the content.

## ui/panel-tabs

### PanelTabAdd +native — The + beside a `PanelTabs` row, for opening another tab.
label?: string — The button's accessible name.

### PanelTabs +native — A row of tabs for a `Panel`, holding `PanelTab`s.
label: string — Names the row for assistive technology: "Open items".
value: string | null — The selected tab, or `null` when none is open.
onClose?: ((value: string) => void) — Called to close a tab: by its ×, a middle-click, or Delete or Backspace.
onValueChange: (value: string) => void — Called with the tab to select: by click, or by the arrow keys.
onMove?: ((value: string, toIndex: number) => void) — Called to move a tab to `toIndex`: by drag, or Ctrl/Cmd+Shift+Arrow.
movedMessage?: ((position: number, count: number) => string) — What a screen reader hears once a tab has moved, given its new 1-based position and the number of tabs.
idPrefix?: string — The prefix of each tab's id and its pane's id (see `panelTabIds`).

### PanelTab +native — One tab.
children: ReactNode — The tab's label.
value: string — Names the tab; matched against `PanelTabs`' `value`.
icon?: ReactNode — Shown before the label.
closeLabel?: string — The ×'s tooltip.

## ui/panel

### PanelHandle +native — The panel's start edge: a focusable separator over its border.
label?: string — The handle's accessible name.

### PanelHeader +native — The panel's top row: a title, then `PanelActions`.

### PanelActions +native — The header's controls, kept at its end edge.

### PanelClose +native — Closes the panel: the caller unmounts it from `onClick`.
label?: string — The button's accessible name.

### PanelContent +native — The panel's body: holds its `PanelPane`s and shows one at a time.
value: string — The `value` of the `PanelPane` to show.
keepMounted?: boolean — Keep every pane mounted, hiding all but the shown one, so a pane keeps its scroll position and anything typed in it while another is in front.

### PanelPane +native — One pane of the panel, and its scroll container.
value: string — Matched against `PanelContent`'s `value`.

### Panel +native — A side panel at the end of a row, resized from its start edge by a `PanelHandle`.
width?: number | null — Controlled width in px.
defaultWidth?: number | null — Seeds the width when `width` is not supplied.
onWidthChange?: ((width: number | null) => void) — Called once per finished resize, with `null` for a reset.
minWidth?: number — The narrowest the panel may be set, in px.
mainMinWidth?: number — The width the content beside the panel always keeps, in px.

## ui/profile-card

### ProfileCard — Canvas profile card: hero identity, status, action chips, shared channels, and pinned skills.
name: string
initials: string
subtitle?: string
statusLabel?: string
statusTone?: BadgeTone
avatarTone?: AvatarTone
tenantMonogram?: string
actions?: readonly ProfileCardAction[]
sharedChannels?: readonly ProfileCardChannel[]
pinnedSkills?: readonly ProfileCardSkill[]
footer?: ReactNode
className?: string

## ui/section

### Section — A titled block: heading, optional description and controls, then content.
title: ReactNode
description?: ReactNode
action?: ReactNode — Controls for this section: a filter, a view toggle, a primary action.
count?: number — Item count shown beside the title.
as?: "h1" | "h2" | "h3" — Heading level.
children: ReactNode
className?: string

## ui/settings-panel

### SettingsPanel — The frame every settings panel shares: a heading, the controls, and — only where it means something — a save control.
title: string
description?: ReactNode
onSave?: (() => void) — Present a save control.
dirty?: boolean — Unsaved changes.
saving?: boolean
error?: string | null
savedAt?: string | null — Set after a successful save so the panel can confirm it happened.
onReset?: (() => void)
children: ReactNode
className?: string

## ui/sidebar-item-row

### SidebarItemRow — The live-updating row: a channel, a thread, a running workflow.
name: ReactNode
leading?: ReactNode — An icon, an avatar, a status dot — whatever leads the row.
meta?: ReactNode — A badge, a status dot, a timestamp — right-aligned, always visible.
action?: ReactNode — A menu trigger or icon button, revealed on hover/focus only.
unread?: boolean
selected?: boolean
leaving?: boolean — Set right before removing the row from its list, and keep it mounted for one more frame (~150ms) so the leave transition gets to play.
onSelect?: (() => void)
className?: string

## ui/sidebar-panel

### SidebarPanel +native — The second column's shell.

### SidebarPanelHeader +native — Not `ui/sidebar`'s `SidebarHeader` — that's the single-column family's header slot.
action?: ReactNode — A single trailing control — "New channel", a filter, a settings icon.

### SidebarPanelPins +native — Global pins live above the per-page sections and never scroll away with them — that is the entire reason this is a separate slot rather than just the first `SidebarPanelSection` inside the body.

### SidebarPanelBody +native — The scrollable region: sections go here.

### SidebarPanelSection +native — The list that holds `SidebarItemRow`s, in `SidebarPanelPins` or `SidebarPanelBody`.
label?: string — A visible heading that also names the list for assistive tech.

### SidebarPanelFooter +native — Not `ui/sidebar`'s `SidebarFooter` — that's the single-column family's footer slot.

## ui/sidebar-search

### SidebarSearch +native — Search row for the rail.
onOpen: () => void — Opens the host's `CommandPalette`.

## ui/sidebar

### Sidebar +native — The app rail.
collapsed?: boolean

### SidebarHeader +native

### SidebarContent +native

### SidebarFooter +native

### SidebarSection +native — One nav section.
label: string

### SidebarItem +native
active?: boolean — Renders the current route.
icon?: ReactNode — Leading icon.
count?: number — Unread / pending count.
asChild?: boolean — Renders the child element instead of an `<a>` — for a router's Link.

### SidebarCollapseToggle +native — Collapse control.
collapsed: boolean
onToggle: () => void

## ui/theme-provider

### ThemeProvider — Owns light/dark/system mode and named preset overlays for the Corbits theme.
children: ReactNode
storageKey?: string — localStorage key.
defaultMode?: ThemeMode
defaultPreset?: ThemePreset
root?: Element | null — Element that receives `.dark`/`.light`, `data-theme`, and `color-scheme`.

## ui/theme-toggle

### ThemeToggle +native — Cycles system → light → dark.
variant?: "link" | "primary" | "secondary" | "outline" | "ghost" | "destructive" | null
size?: "sm" | "md" | "lg" | "icon" | null
asChild?: boolean
label?: string — Override the accessible name; defaults to the current mode label.

## ui/top-bar

### TopBar +native — The row above the page.

### TopBarTitle +native
count?: number
subtitle?: string

### TopBarBreadcrumbs +native — Breadcrumb trail.
crumbs: readonly Crumb[]
linkComponent?: ComponentType<BreadcrumbLinkProps> — Renders every non-last crumb; defaults to a plain `<a>`.

### TopBarActions +native — Trailing controls.

## ui/view-toggle

### ViewToggle — Grid or rows, as a segmented control.
mode: ViewMode
onChange: (mode: ViewMode) => void
className?: string

<!-- Generated from @corbits/react-ui 0.5.0. Regenerate: bun scripts/react-ui-api.ts -->

# react-ui: tables, stats, charts, status, avatars, empty and loading states (0.5.0)

Props per exported component, from the installed declarations. `?` marks optional. `+native` means the component also accepts the native props of the element it renders (`className`, `onClick`, ...). Import from the package root unless SKILL.md lists the module as a subpath.

## ui/animated-number

### AnimatedNumber — A number that counts to its new value instead of snapping.
value: number
decimals?: number — Decimal places for the default formatting.
format?: ((value: number) => string)
durationMs?: number — Duration of the count, in ms.
className?: string

## ui/avatar

### Avatar — Initials avatar with optional tenant monogram badge.
initials: string — One or two characters shown when no image is provided.
label: string
tone?: AvatarTone
size?: AvatarSize
shape?: AvatarShape — `circle` is fully round; `square` rounds by `--avatar-radius` (defaults to `--radius`).
status?: AvatarStatus — Corner dot marking state; the label gains the state for assistive tech.
orbit?: boolean — Orange arc circling the avatar.
tenantMonogram?: string — Tenant monogram badge overlaid on the corner.
className?: string

### AvatarStack — Overlapping avatar stack for thread participants and channel members.
items: readonly AvatarStackItem[]
max?: number — Cap visible avatars; remainder becomes a +N chip.
size?: AvatarSize
shape?: AvatarShape — Default shape for every item; an item's own `shape` wins.
className?: string

## ui/badge

### Badge +native
tone?: "neutral" | "accent" | "info" | "success" | "warning" | "danger" | "shared" | "access" | null

## ui/bar-chart

### BarChart — One value per category, as horizontal bars.
title: string
description?: string
data: readonly BarDatum[]
valueLabel?: string — Column header for the value in the table view.
format?: ((value: number) => string) — Formats the value at each bar's tip and in the table.
className?: string

## ui/block-card

### BlockCard — The generative-UI block frame: a bordered, square-cornered card with a pulse-dot header.
title: string
children: ReactNode
className?: string

### RiskBadge — A risk callout for a block whose action carries consequence — approve this order cancellation, run this migration.
level: RiskLevel
label: string
note?: string
className?: string

## ui/category-bars

### CategoryBars — Dense horizontal category ranking for cost-by-model / calls-by-tool style tables.
title: string
description?: string
data: readonly CategoryBarDatum[]
valueLabel?: string
format?: ((value: number) => string)
className?: string

## ui/chart-frame

### ChartFrame — The frame every chart here sits in: a caption, a legend, the plot, and the same data as a table.
title: string — Names the chart.
description?: string
legend?: readonly ChartLegendEntry[] — Omit for a single series — one swatch restating the title is wasted space.
table: ChartTable — The same numbers as a table.
children: ReactNode — The plot itself — an `<svg>`.
className?: string

## ui/csv-table

### CsvTable — CSV text, rendered as a table when that is honest and as raw text when it is not.
text?: string
sheets?: readonly CsvTableSheet[] — Several sheets of one workbook, switched by tabs under the grid.
caption?: string
interactive?: boolean — A compact spreadsheet grid that sorts, selects and copies, and applies the host's `query` and `filters`.
query?: string — The search query.
filters?: Readonly<Record<string, string>>
sort?: CsvSort | null
onSortChange?: ((sort: CsvSort | null) => void)
sheet?: number — The open sheet's index in `sheets`.
onSheetChange?: ((sheet: number) => void)
labels?: Partial<CsvTableLabels>
onSelectionChange?: ((selection: CsvSelection | null) => void)

## ui/empty-state

### EmptyState — Nothing to show, said properly.
title: string — What is not here, as a statement: "No workflows yet".
description?: ReactNode — Why, or what to do about it.
icon?: ReactNode
action?: ReactNode — The way out — a create button, a "clear filters" control.
className?: string

## ui/gate-block

### GateBlock — Presentational chrome for a pending gate: a run parked on a human decision.
gate: GateShellModel
children?: ReactNode — The interactive payload — a review list, choice buttons, a form.
footer?: ReactNode
className?: string

## ui/live-run-banner

### LiveRunBanner — The one-line status strip above a live run's steps: awaiting gets the accent tone that marks "this needs you" everywhere else in the registry, running gets the info tone.
awaiting?: boolean
message?: string
elapsed?: string
className?: string

## ui/live-status-line

### LiveStatusLine — The single "what's happening now" line under a stepper.
label: string
className?: string

### LiveStatusSlot — Layout-stable wrapper for `LiveStatusLine`: a `null` label collapses the slot's height instead of the line disappearing instantly, so the body below it doesn't jump at every gate-to-processing boundary.
label: string | null — `null` animates the line out and renders nothing.
className?: string

## ui/progress-checklist

### ProgressChecklist — A list of steps and how far along they are — a long operation reporting itself while the user waits.
steps: readonly ChecklistStep[]
label?: string
className?: string

## ui/quote-card

### QuoteCard — A quote, rotated once per page load.
quotes: readonly Quote[] — Yours.
storageKey?: string — A key in `localStorage` for the last-shown index, so the card advances once per visit instead of showing the same line forever.
className?: string

## ui/rich-empty-state

### RichEmptyState — The onboarding-grade empty state: icon, message, and suggested actions on a bordered surface of its own.
icon?: ReactNode
title: string — What is not here, as a statement: "No skills installed yet".
description: ReactNode — Why, and what this surface will look like once it is populated.
actions?: readonly RichEmptyStateAction[] — Suggested next steps, rendered as buttons or links.
footer?: ReactNode — Extra controls (e.g a menu) below the primary actions.
actionSize?: "sm" | "md" | "lg" | "icon" | null — Action button size.
className?: string

## ui/shimmer-text

### ShimmerText — A shimmer sweep over inline text: a brighter band slides through the words to signal "still going" without the words themselves changing.
children: string
role?: "status" — Omit when an ancestor already carries the live region.
className?: string

## ui/skeleton

### Skeleton +native — A placeholder for content that has not arrived.

## ui/sortable-table

### SortableTable — A table you can sort by clicking a header.
caption: string
rows: readonly T[]
columns: readonly SortableColumn<T>[]
rowKey: (row: T) => string
initialSort?: { readonly key: string; readonly direction: SortDirection; }
empty?: ReactNode
className?: string

## ui/sparkline

### Sparkline — A trend, at the size of a word.
values: readonly number[]
summary: string — What the shape means, in words — "Up 12% over 30 days".
className?: string

## ui/stat-grid

### StatGrid — The KPI band: a fixed responsive grid of `StatGridItem`s.
children: ReactNode
columns?: StatGridColumns — Responsive column count; defaults to four-up on wide screens.
className?: string

### StatGridItem — One KPI: caption label, headline number, optional delta, trend and small print.
label: string
value: string — Pre-formatted.
sub?: ReactNode — Small print under the number — a rate, a share, a caveat.
accent?: boolean — Orange action tone — reserve for genuine action/positive emphasis.
danger?: boolean — Semantic danger — failure counts, not the action accent.
emphasis?: boolean — Headline tile: larger value + padding.
delta?: ReactNode — Optional period-over-period badge (e.g a `DeltaBadge`).
sparkline?: ReactNode — Custom sparkline slot; overrides `sparklineValues` when both are set.
sparklineValues?: readonly number[] — When set (and `sparkline` is omitted), renders the built-in trend line.
sparklineLabel?: string — Words for the built-in trend's shape; defaults to "{label} trend".
onClick?: (() => void) — When set, the tile is a real `<button>` and activates on click/Enter/Space.
className?: string

## ui/status-dot

### StatusDot
label: string — Names the state for assistive tech.
live?: boolean — Adds a ring that pulses outward: this state is live and still changing.
tone?: StatusDotTone
size?: StatusDotSize — `sm` (8px, default) beside body text; `xs` (6px) inside dense chrome.
className?: string

## ui/step-list

### StepListRow — One step row — a mark carrying its own glyph and colour, a name, and the status spelled out in text so it never depends on colour alone.
step: StepListItem
className?: string

### StepList — A run's steps and how far along each one is.
steps: readonly StepListItem[]
label?: string — Names the list.
className?: string

## ui/table

### Table +native

### TableHeader +native

### TableBody +native

### TableRow +native

### TableHead +native

### TableCell +native

### TableCaption +native

## ui/time-series-chart

### TimeSeriesChart — Several series over one shared x axis.
title: string
description?: string
labels: readonly string[] — The shared x axis — pre-formatted period labels.
series: readonly TimeSeries[] — At most five.
variant?: "area" | "line" — `area` fills under each line at low opacity — the treatment for volume ("how much accumulated") where a bare line reads as a rate.
format?: ((value: number) => string)
className?: string

## ui/token-mosaic

### TokenMosaic — Shares of a whole as one stacked strip, with a legend that names and quantifies every segment.
parts: readonly { readonly label: string; readonly value: number; }[] — Shares of one whole, in a stable order — colour is assigned by position.
label: string — What the whole is — "Token usage by class".
className?: string

## ui/trace-waterfall

### TraceWaterfall — Run-trace timeline: one row per span with a duration, and optional token count.
title: string
description?: string
spans: readonly TraceSpan[]
className?: string

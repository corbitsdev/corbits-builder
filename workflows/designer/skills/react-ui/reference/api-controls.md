<!-- Generated from @corbits/react-ui 0.5.0. Regenerate: bun scripts/react-ui-api.ts -->

# react-ui: buttons, inputs, filters, dialogs, menus and toasts (0.5.0)

Props per exported component, from the installed declarations. `?` marks optional. `+native` means the component also accepts the native props of the element it renders (`className`, `onClick`, ...). Import from the package root unless SKILL.md lists the module as a subpath.

## ui/bulk-action-bar

### BulkActionBar — The floating pill that appears once a list has a selection: fixed to the bottom of the viewport (or the nearest ancestor that establishes its own containing block — a `transform`, `filter`, or similar CSS property on an ancestor changes what `fixed` positions against), riding in with a small rise so it reads as newly arrived rather than always having been there.
count: number
onClear: () => void
children: ReactNode — Action buttons, rendered after the "N selected" label — typically `Button`s.
label?: string — Overrides the default `"Bulk actions"` accessible name outright — for a consumer localizing this published library's one hardcoded English string.
className?: string

## ui/button

### Button +native
variant?: "link" | "primary" | "secondary" | "outline" | "ghost" | "destructive" | null
size?: "sm" | "md" | "lg" | "icon" | null
asChild?: boolean

## ui/checkbox

### Checkbox
checked: boolean
onCheckedChange: (checked: boolean) => void
label?: string — Row label.
description?: string — Explanatory text under the label, tied to the control via `aria-describedby`.
indeterminate?: boolean — A checkbox is neither on nor off — some of its children are checked and some are not.
id?: string
disabled?: boolean
invalid?: boolean
describedBy?: string — Id of external text describing the control, for `aria-describedby`.
className?: string

## ui/command-palette

### CommandPalette — The palette as a modal dialog: a search input over consumer-supplied, pre-grouped results, centered over an overlay.
query: string
onQueryChange: (query: string) => void
groups: readonly CommandPaletteGroup[] — Pre-grouped, pre-ordered results.
onSelect: (id: string) => void
loading?: boolean
error?: ReactNode — A message to show in place of results; presence alone marks the errored state.
hasMore?: boolean
onLoadMore?: (() => void)
placeholder?: string
inputAccessory?: ReactNode — Leading content in the input row — a scope chip, a source badge.
footer?: ReactNode — A legend or hint strip pinned under the results, e.g keyboard shortcut hints.
open: boolean
onOpenChange: (open: boolean) => void
className?: string

### CommandPaletteInline — The palette as an inline, non-modal surface: the field sits wherever the consumer puts it — a top bar, a toolbar — and its results hang directly beneath, anchored to that field.
query: string
onQueryChange: (query: string) => void
groups: readonly CommandPaletteGroup[] — Pre-grouped, pre-ordered results.
onSelect: (id: string) => void
loading?: boolean
error?: ReactNode — A message to show in place of results; presence alone marks the errored state.
hasMore?: boolean
onLoadMore?: (() => void)
placeholder?: string
inputAccessory?: ReactNode — Leading content in the input row — a scope chip, a source badge.
footer?: ReactNode — A legend or hint strip pinned under the results, e.g keyboard shortcut hints.
open: boolean
onOpenChange: (open: boolean) => void
leading?: ReactNode — Rendered inside the field, ahead of the input, in both states — the control the field morphs out of and back into.
className?: string

## ui/confirm-button

### ConfirmButton +native — A destructive action behind a second click.
variant?: "link" | "primary" | "secondary" | "outline" | "ghost" | "destructive" | null
size?: "sm" | "md" | "lg" | "icon" | null
asChild?: boolean
onConfirm: () => void — Fires on the second, confirming click only.
children: ReactNode
confirmLabel?: ReactNode
resetMs?: number — How long the armed state lasts before disarming, in ms.
defaultArmed?: boolean — Start already armed.

## ui/dialog

### DialogContent +native
side?: DialogSide

### DialogHeader +native — `pr-8` keeps the title clear of the close control in the corner.

### DialogBody +native — Scrolls; the header and footer stay put.

### DialogFooter +native

### DialogTitle +native

### DialogDescription +native

### DialogFieldLabel +native — Uppercase field label used inside dialog forms.

### Dialog +native — The modal surface, in the three places a modal arrives from: the centre of the page, the right edge, the left edge.

### DialogTrigger +native

### DialogClose +native

## ui/file-input

### FileInput +native — A drop zone that is also a button that is also a real file input.
onFiles: (files: FileList) => void
label?: string
hint?: string
className?: string

## ui/filter-bar

### FilterBar — A row of filters, and — the part that is usually missing — a readable summary of which ones are on.
filters: readonly FilterSpec[]
onChange: (id: string, value: string | null) => void
children?: ReactNode — Rendered at the end — a time range, an export button.
className?: string

## ui/filter-chip

### FilterChip — A toggleable filter pill — a category, a tag, a facet value.
selected?: boolean
onClick?: (() => void)
children: ReactNode
count?: number
className?: string

## ui/horizontal-stepper

### HorizontalStepper — A phase rail: numbered pills connected by a rail that fills in once the segment behind it actually completes — the fill never runs ahead of real work.
steps: readonly WorkflowStep[]
className?: string

## ui/input

### Input +native

## ui/intake-form

### IntakeForm — The inputs a run needs, rendered from a field list.
fields: readonly IntakeField[]
values: Readonly<Record<string, unknown>>
onChange: (next: Record<string, unknown>) => void
idPrefix?: string — Disambiguates ids when two forms are on one page.
disabled?: boolean
className?: string

## ui/menu

### MenuContent +native

### MenuItem +native

### MenuLabel +native

### MenuSeparator +native

### Menu +native — The popover menu used by toolbars and selectors.

### MenuTrigger +native

### MenuGroup +native

## ui/run-now-button

### RunNowButton +native — Fire something off now — send the brief, run the schedule ahead of time.
variant?: "link" | "primary" | "secondary" | "outline" | "ghost" | "destructive" | null
size?: "sm" | "md" | "lg" | "icon" | null
asChild?: boolean
onRun: () => void | Promise<void> — Resolve when the work is accepted, reject to show nothing changed.
label?: string
pendingLabel?: string
doneLabel?: string
confirmMs?: number — How long the confirmation stays up, in ms.

## ui/select

### Select +native

## ui/selection-checkbox

### SelectionCheckbox — A row's selection control: hidden until the row is hovered or focused, and always visible on a touch device — there is no hover to reveal it on, so `(hover: none)` forces it on.
checked: SelectionCheckboxState — `"indeterminate"` is for a header checkbox driven by `selectAll`: some but not all rows are selected.
onToggle: (event: { readonly shiftKey: boolean; }) => void — Fires on both a plain click and a cmd/ctrl-click — `useListSelection`'s `toggle` takes the same `shiftKey` modifier this passes through, so a row wires this straight to it without branching on the click type itself.
rowLabel: string — Row label for the default accessible name, e.g `Select "Q3 rollup"`.
ariaLabel?: string — Overrides the default `Select ${rowLabel}` accessible name outright — for a consumer localizing this published library's one hardcoded English string, or phrasing the row label differently than "Select ".
id?: string
className?: string

## ui/switch

### Switch — An on/off setting.
checked: boolean
onCheckedChange: (checked: boolean) => void
label?: string — Accessible name.
id?: string
disabled?: boolean
describedBy?: string — Ids of the text describing the setting, for `aria-describedby`.
className?: string

## ui/tabs

### Tabs — Tabs that behave the way the tab pattern promises.
tabs: readonly TabDescriptor<Id>[]
active: Id
onChange: (id: Id) => void
label: string — Names the set for assistive tech: "Insights sections".
children: (active: Id) => ReactNode — Renders the active panel.
variant?: "underline" | "enclosed" — `underline` for page-level navigation, `enclosed` for tabs inside a card.
className?: string

## ui/textarea

### Textarea +native
autoResize?: boolean — Grows the textarea to fit its content instead of scrolling internally.
maxHeight?: number — Pixel height autoResize grows to before it caps and scrolls.

## ui/toast

### Toaster +native — Mount once at the app root.

## ui/tooltip

### InfoTooltip — A focusable info glyph that discloses a short note on hover or focus.
label: string — The note shown in the tooltip and bound to the trigger via `aria-describedby`.
triggerLabel?: string — Accessible name for the trigger button.
defaultOpen?: boolean — Render already open — uncontrolled, for stories and screenshots.
className?: string

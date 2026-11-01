# react-ui: data display, empty and loading states

Source: @corbits/react-ui 0.5.0 npm package (README.md and dist/ui/*.d.ts), the version pinned in workflows/coder/starter/client/package.json
Fetched: 2026-10-29

---

## Tables

`SortableTable<T>`: click-to-sort over rows already in memory.

```tsx
<SortableTable
  caption="Orders" // required, names the table
  rows={orders}
  rowKey={(o) => o.id}
  initialSort={{ key: "placed", direction: "desc" }}
  empty={<EmptyState title="No orders yet" />}
  columns={[
    {
      key: "customer",
      header: "Customer",
      cell: (o) => o.customer,
      sortValue: (o) => o.customer,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (o) => money(o.total),
      sortValue: (o) => o.total,
    },
    {
      key: "actions",
      header: "",
      cell: (o) => (
        <Button size="sm" variant="ghost">
          Open
        </Button>
      ),
    },
  ]}
/>
```

A column without `sortValue` is presentation-only (row actions). Sorting is
client-side, so it is only correct when the whole set is loaded; for paged
data sort on the server.

`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`,
`TableCaption` are the unstyled-logic primitives when you need a custom row.
Wide tables scroll inside their own container, so the page itself stays put.

## Numbers and charts

- `StatGrid` with `StatGridItem`: the KPI band. `columns` is 2 to 5.
  Item props: `label`, `value` (pre-formatted string), `sub`, `delta`,
  `sparklineValues`, `accent` (action emphasis), `danger` (failure counts),
  `emphasis` (headline tile), `onClick` (makes it a real button). Use it only
  for numbers the person acts on.
- `ChartFrame` (`title`, `description`, `legend`, `table`): caption, legend,
  plot and the same data as a table. Wrap a custom plot in it.
- `TimeSeriesChart` (`title`, `labels`, `series: {label, values}[]`,
  `variant: "line" | "area"`, `format`), `BarChart` (`title`, `data:
  {label, value}[]`, `format`), `CategoryBars` (dense ranking), `Sparkline`,
  `TokenMosaic` (shares of a whole), `AnimatedNumber`.

## Status and identity

- `Badge` `tone`: `neutral | accent | info | success | warning | danger |
  shared | access`. Type a state-to-tone lookup with `BadgeTone`. Always
  carry the state as text in the badge, not colour alone.
- `StatusDot` (`label` required, `tone`, `live`, `size`): pass `label=""`
  only when adjacent text already names the state.
- `Avatar` (`initials`, `label`, `size`, `shape`, `status`, `tone`) and
  `AvatarStack` (`items`, `max`).
- `ProfileCard`: identity, status, actions and channels.
- `ProgressChecklist`, `StepList`, `HorizontalStepper`: steps of a long
  operation and how far along it is.

## Empty states

- `EmptyState` (`title`, `description`, `icon`, `action`): the quiet in-list
  "nothing here". Title is a statement ("No orders yet"), description says
  why or what to do, `action` is the way out (a create button, "Clear
  filters"). Pass it as the `empty` of a list or table.
- `RichEmptyState` (`title`, `description`, `icon`, `actions: {label,
  onClick?, href?, variant?}[]`): for a surface that is empty because the
  person has not started; the empty state is the page and carries the way in.
  At most one `primary` action.
- `ConversationEmptyState`, `InspectorEmpty`: the same for those surfaces.

## Loading

`Skeleton` is a shape sized by `className` (for example `h-4 w-1/2`), hidden
from assistive tech. Render a sibling `role="status"` line ("Loading orders")
with the skeletons. Make the skeleton match the layout it replaces (same
rows, same columns) so nothing jumps when data arrives. The starter's
`QueryState` already renders loading, error with retry, and the empty state
you pass; use it for every data screen.

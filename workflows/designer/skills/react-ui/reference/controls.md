# react-ui: controls

Source: @corbits/react-ui 0.5.0 npm package (README.md and dist/ui/*.d.ts), the version pinned in workflows/coder/starter/client/package.json
Fetched: 2026-10-29

---

## Buttons

`Button`: `variant` is `primary | secondary | outline | ghost | destructive | link`,
`size` is `sm | md | lg | icon`, `asChild` renders the child (a router `Link`)
with the button styling. At most one `primary` per screen region; the rest are
`outline` or `ghost`. An icon-only button needs `aria-label`.

`ConfirmButton`: asks for a second click before a destructive action
(`onConfirm`, `confirmLabel`, `resetMs`). Use it instead of a dialog for a
quick delete. `RunNowButton`: run something immediately.

## Text and choice inputs

| Component           | Notes                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Input`             | A styled `<input>`; takes all native props.                                                                                                               |
| `Textarea`          | `autoResize`, `maxHeight` (px) grow it with its content.                                                                                                  |
| `Select`            | A styled native `<select>`; children are `<option>`s.                                                                                                     |
| `Checkbox`          | Controlled: `checked`, `onCheckedChange`, `label`, `description`, `indeterminate`, `invalid`, `describedBy`.                                              |
| `Switch`            | Controlled: `checked`, `onCheckedChange`, `label`, `describedBy`. For a setting that applies immediately.                                                 |
| `SelectionCheckbox` | Row-selection checkbox for tables.                                                                                                                        |
| `FileInput`         | File picker.                                                                                                                                              |
| `KindCardGrid`      | Selectable card grid for choosing one of a few kinds: `options: {id, title, description?, icon?}[]`, `value`, `onChange`, `label`, `columns` (2, 3 or 4). |

There is no `Field`/`Form` component. A form is a column of label + control +
help/error text, built with plain `<label htmlFor>`, `aria-describedby` for the
help or error text and `aria-invalid` on a control with an error. Keep forms to
one column, 640px wide at most (`PageShell width="prose"`). Validate on submit
with the same zod schema the server uses (from `@app/shared`) and show each
error under its field in `text-destructive`. Disable the submit button while
the mutation runs and show the saved result as a `toast`.

## Navigation and filtering

| Component       | Notes                                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Tabs`          | Controlled: `tabs: {id, label, count?}[]`, `active`, `onChange`, `label` (names the set), `children: (active) => ReactNode` (only the open panel mounts), `variant`: `underline` (page level) or `enclosed` (inside a card). Keep the active tab in the URL (search param) so it is linkable. |
| `FilterBar`     | `filters: {id, label, options, value, anyLabel}[]`, `onChange(id, value \| null)`; shows removable chips for what is on and "Clear all". Keep filter state in the URL.                                                                                                                        |
| `FilterChip`    | One toggleable chip (`selected`, `onClick`, `count`).                                                                                                                                                                                                                                         |
| `ViewToggle`    | `mode: "grid" \| "rows"`, `onChange`.                                                                                                                                                                                                                                                         |
| `BulkActionBar` | Appears for a multi-row selection: `count`, `onClear`, children are the actions.                                                                                                                                                                                                              |

## Overlays (extra packages, subpath imports)

```tsx
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@corbits/react-ui/ui/dialog";
```

`DialogContent side="center" | "left" | "right"`: a centred modal or a
full-height side sheet; `DialogBody` scrolls while header and footer stay
put. Needs `@radix-ui/react-dialog`. `DialogFieldLabel` is the uppercase label
for dialog forms.

`ui/menu` (needs `@radix-ui/react-dropdown-menu`): `Menu`, `MenuTrigger`,
`MenuContent`, `MenuItem`, `MenuLabel`, `MenuGroup`, `MenuSeparator`.
`ui/tooltip` (needs `@radix-ui/react-tooltip`): `InfoTooltip` (`label`,
`triggerLabel`). `ui/command-palette` and `ui/sidebar-search`: global search.

## Toasts (already installed in the starter)

```tsx
import { toast } from "@corbits/react-ui/ui/toast";
toast("Order saved");
```

`toast(message: string)` shows plain text, one at a time. `<Toaster />` is
already mounted once in `main.tsx`. Use toasts for the result of an action
the person just took, and keep data they need to keep reading on the page.

## Theme

`ThemeToggle` is a light/dark/system switch for the top bar. `ThemeProvider`
(mounted by the starter) provides `useTheme()` with `mode`, `setMode`,
`resolvedMode`, `preset`.

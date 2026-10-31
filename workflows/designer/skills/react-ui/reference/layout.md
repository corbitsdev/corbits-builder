# react-ui: layout components

Source: @corbits/react-ui 0.4.0 npm package (README.md and dist/ui/*.d.ts), the version pinned in workflows/coder/starter/client/package.json
Fetched: 2026-10-29

---

All from the package root.

## The frame

| Component             | Use                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageShell`           | The page's outer boundary: full height, one scroll container, consistent margins. `width`: `"prose"` (reading), `"wide"` (app screens), `"full"` (dashboards). `scroll={false}` when the page has its own scrolling body under a sticky header, so two scroll containers never nest. Draws nothing.                                                       |
| `PagePanel`           | Bordered frame for page content. `surface`: `"background"` or `"card"`. Also `flat`, `scroll`, `fitContent`.                                                                                                                                                                                                                                              |
| `TopBar`              | `<header>` row above the page. Children: `TopBarTitle` (`count`, `subtitle`), `TopBarBreadcrumbs` (`crumbs: {label, href?}[]`; the last crumb is the current page and never a link), `TopBarActions` (pushes right; put it last).                                                                                                                         |
| `Sidebar`             | The app rail. `collapsed` is a prop you own. Parts: `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarSection` (requires `label`), `SidebarItem` (`active`, `icon`, `count`, `asChild`), `SidebarCollapseToggle` (`collapsed`, `onToggle`). A collapsed rail keeps its accessible names.                                                        |
| `SidebarPanel` family | A second column with pins, scrolling body and footer: `SidebarPanelHeader` (`title`, `action`), `SidebarPanelPins`, `SidebarPanelBody`, `SidebarPanelSection` (`label`), `SidebarPanelFooter`, rows via `SidebarItemRow` (`name`, `leading`, `meta`, `action`, `unread`, `selected`, `onSelect`). For channel or thread style lists, not main navigation. |

The starter's `Layout` is a top bar over `PageShell width="wide"`. For an
app with more than three or four destinations, replace it with a `Sidebar`
rail on the left (a drawer behind a menu button on narrow screens) and keep
`TopBar` for the page title, breadcrumbs and actions.

Router links in the nav:

```tsx
<SidebarItem asChild active={pathname === "/orders"} icon={<Package />}>
  <Link to="/orders">Orders</Link>
</SidebarItem>
```

Breadcrumb links need a stable module-scope wrapper for the router; an
inline arrow remounts every crumb:

```tsx
const CrumbLink = ({ href, ...rest }: BreadcrumbLinkProps) => (
  <Link to={href} {...rest} />
);
<TopBarBreadcrumbs crumbs={crumbs} linkComponent={CrumbLink} />;
```

## Inside a page

| Component                                                              | Use                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Section`                                                              | Titled block: `title`, `description`, `action`, `count`, `as` (`"h1"` for the page's own header, otherwise `h2`/`h3`). The page header and every section header are this one component.                                     |
| `LibraryPageHeader`                                                    | Title, count and controls row for a collection page (`title`, `titleSize`, `count`, `subtitle`, children for the controls).                                                                                                 |
| `ListDetail`                                                           | Index left, open item right. Two panes from `lg`; on narrow screens the detail replaces the list. `onCloseDetail` is required (the mobile back control). Props: `list`, `detail` (or `null`), `placeholder`, `detailLabel`. |
| `InspectorShell`                                                       | Right-hand inspector: `InspectorHeader`, `InspectorKv` (label/value rows), `InspectorEmpty`, `InspectorPanelTitle`.                                                                                                         |
| `SettingsPanel`                                                        | Settings frame: `title`, `description`, `onSave`, `dirty`, `saving`, `error`, `savedAt`, `onReset`. Gives save state one consistent place.                                                                                  |
| `Card` with `CardHeader`, `CardTitle`, `CardDescription`, `CardFooter` | Bordered surface for an item opened as a unit or a labelled group. Not a wrapper for the only thing on a page.                                                                                                              |
| `NowCards`, `NowSection`                                               | Attention band for items needing action.                                                                                                                                                                                    |
| `AuthLayout`, `LoginForm`                                              | Sign-in screens.                                                                                                                                                                                                            |
| `BootScreen`                                                           | Shown before the app loads.                                                                                                                                                                                                 |

## Composition

```tsx
<PageShell width="wide">
  <Section
    as="h1"
    title="Orders"
    count={orders.length}
    action={<Button>New order</Button>}
  >
    <FilterBar filters={filters} onChange={setFilter} />
    <SortableTable
      caption="Orders"
      rows={orders}
      columns={columns}
      rowKey={(o) => o.id}
    />
  </Section>
</PageShell>
```

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import {
  ProjectLibraryView,
  type LibraryProject,
  type ProjectLibraryViewProps,
} from "./project-library.view.tsx";
import {
  ProjectMenuView,
  type ProjectMenuViewProps,
} from "./project-menu.view.tsx";

// Holds what the page asks its host to keep: the filter pressed and the layout chosen.
function Page(args: ProjectLibraryViewProps) {
  const [filter, setFilter] = useState(args.filter);
  const [layout, setLayout] = useState(args.layout);
  return (
    <ProjectLibraryView
      {...args}
      filter={filter}
      onFilterChange={setFilter}
      layout={layout}
      onLayoutChange={setLayout}
    />
  );
}

const page = (title: string, lines: readonly string[]) => `<!doctype html>
<html>
  <body style="margin:0;font-family:system-ui;background:#fbf7f1;color:#2b2118">
    <header style="padding:32px 48px;border-bottom:1px solid #e5dccf">
      <strong style="font-size:28px">${title}</strong>
    </header>
    <main style="padding:48px">
      ${lines.map((line) => `<p style="font-size:32px;margin:0 0 24px">${line}</p>`).join("")}
    </main>
  </body>
</html>`;

const bakery: LibraryProject = {
  id: "bakery-orders",
  title: "Bakery orders",
  stage: "building",
  lastActivityAt: "2026-11-10T08:12:00.000Z",
  lastActive: "2 hours ago",
  mockup: page("Northside Bakery", [
    "Saturday orders",
    "14 to bake, 3 to collect before noon.",
  ]),
};
const rota: LibraryProject = {
  id: "volunteer-rota",
  title: "Volunteer rota for the community garden",
  stage: "shipped",
  lastActivityAt: "2026-11-08T17:40:00.000Z",
  lastActive: "2 days ago",
  mockup: page("Garden rota", ["This week", "Watering: Sam, Priya, Jo"]),
};
const tracker: LibraryProject = {
  id: "reading-tracker",
  title: "Reading tracker",
  stage: "idea",
  lastActivityAt: "2026-11-05T10:00:00.000Z",
  lastActive: "5 days ago",
  mockup: null,
};
const invoices: LibraryProject = {
  id: "invoice-reminders",
  title: "Invoice reminders",
  stage: "building",
  lastActivityAt: "2026-10-29T13:25:00.000Z",
  lastActive: "12 days ago",
  mockup: null,
};
const recipes: LibraryProject = {
  id: "recipe-box",
  title: "Recipe box",
  stage: "idea",
  lastActivityAt: "2026-10-02T09:00:00.000Z",
  lastActive: "last month",
  mockup: null,
};
const archived: LibraryProject = {
  id: "old-landing-page",
  title: "Old landing page",
  stage: "archived",
  lastActivityAt: "2026-06-18T15:00:00.000Z",
  lastActive: "5 months ago",
  mockup: null,
};

const menu: Omit<ProjectMenuViewProps, "trigger"> = {
  align: "end",
  archived: false,
  shipped: false,
  onShowInfo: fn(),
  onRename: fn(),
  onExport: fn(),
  onToggleShipped: fn(),
  onToggleArchived: fn(),
  onDelete: fn(),
  infoDialog: null,
  exportDialog: null,
};

const meta = {
  title: "Screens/Projects/Library",
  component: ProjectLibraryView,
  parameters: { layout: "fullscreen" },
  args: {
    status: "ready",
    filter: null,
    onFilterChange: fn(),
    counts: { idea: 2, building: 2, shipped: 1, archived: 1 },
    projects: [bakery, rota, tracker, invoices, recipes],
    layout: "grid",
    onLayoutChange: fn(),
    onOpen: fn(),
    onNewProject: fn(),
    onCoverNear: fn(),
    menu: (_projectId, trigger) => (
      <ProjectMenuView {...menu} trigger={trigger} />
    ),
    focusAfterChange: null,
  },
  render: (args) => <Page {...args} />,
} satisfies Meta<typeof ProjectLibraryView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tiles: Story = {};

/** One line per project; the covers shrink to a swatch of their pattern. */
export const List: Story = {
  args: {
    layout: "rows",
    projects: [bakery, rota, tracker, invoices, recipes].map((project) => ({
      ...project,
      mockup: null,
    })),
  },
};

export const LongTitles: Story = {
  args: {
    layout: "rows",
    projects: [
      {
        ...invoices,
        title:
          "Build an internal tool for approving purchase requests. Staff submit a request with an amount and a reason, their manager approves or rejects it, and anything over $5,000 also needs finance approval.",
      },
      { ...recipes, title: "RecipeBox".repeat(40) },
    ],
  },
};

export const FilteredToBuilding: Story = {
  args: { filter: "building", projects: [bakery, invoices] },
};

/** Archived projects show only under their own filter, where they can be restored. */
export const Archived: Story = {
  args: { filter: "archived", projects: [archived] },
};

export const Reading: Story = { args: { status: "loading", projects: [] } };

export const Unreadable: Story = { args: { status: "failed", projects: [] } };

export const NoProjects: Story = {
  args: {
    projects: [],
    counts: { idea: 0, building: 0, shipped: 0, archived: 0 },
  },
};

export const EveryProjectArchived: Story = {
  args: {
    projects: [],
    counts: { idea: 0, building: 0, shipped: 0, archived: 1 },
  },
};

export const NothingUnderTheFilter: Story = {
  args: {
    filter: "shipped",
    projects: [],
    counts: { idea: 2, building: 2, shipped: 0, archived: 1 },
  },
};

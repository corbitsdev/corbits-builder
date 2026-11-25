import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { FilesListProps } from "./files-list.tsx";
import {
  finishedFiles,
  largeFiles,
  smallFiles,
} from "./files-list.stories.tsx";
import { building, planning, ran, row } from "./plan-timeline.stories.tsx";
import {
  ProjectSidebarView,
  type ProjectSidebarViewProps,
} from "./project-sidebar.view.tsx";
import type { SidebarSectionsProps } from "./sidebar-sections.tsx";
import { preview } from "./sidebar-sections.stories.tsx";
import { wording } from "../../config.ts";

const words = wording.projectShell;

// Holds what the page would: what is on the page, the step opened from the plan and whether the
// sidebar is out, so a story can be clicked through.
function Clickable(args: ProjectSidebarViewProps) {
  const { plan, files, sections } = args;
  const [shown, setShown] = useState(files?.shown ?? null);
  const [step, setStep] = useState(plan.selected);
  const [open, setOpen] = useState(args.open);
  return (
    <ProjectSidebarView
      {...args}
      open={open}
      onToggleSidebar={() => {
        setOpen(!open);
        args.onToggleSidebar();
      }}
      plan={{
        ...plan,
        selected: step,
        onOpenStep: (id, tab) => {
          setStep(id);
          setShown(tab);
          plan.onOpenStep(id, tab);
        },
      }}
      files={
        files === undefined
          ? undefined
          : {
              ...files,
              shown,
              onOpen: (tab) => {
                setShown(tab);
                files.onOpen(tab);
              },
            }
      }
      sections={
        sections === undefined
          ? undefined
          : {
              sections: sections.sections.map((each) => ({
                ...each,
                selected: each.id === shown,
              })),
              onOpen: (id) => {
                setShown(id);
                sections.onOpen(id);
              },
            }
      }
    />
  );
}

/** The sidebar on the room's ground at the window's full height, so its card and title row show. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        height: "100vh",
        background: "var(--wb-background)",
      }}
    >
      {children}
    </div>
  );
}

const plan = (
  steps: ProjectSidebarViewProps["plan"]["plan"],
): ProjectSidebarViewProps["plan"] => ({
  plan: steps,
  selected: null,
  waitsOn: null,
  onOpenStep: fn(),
});

const meta = {
  title: "Screens/Workspace/ProjectSidebar",
  component: ProjectSidebarView,
  parameters: { layout: "fullscreen" },
  args: {
    project: "Bakery orders",
    open: true,
    drawer: false,
    plan: plan(planning),
    onToggleSidebar: fn(),
    onHome: fn(),
    onPreferences: fn(),
  },
  render: (args) => (
    <Shell>
      <Clickable {...args} />
    </Shell>
  ),
} satisfies Meta<typeof ProjectSidebarView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** While a ready-made plan runs, with no app yet. */
export const Planning: Story = {};

const buildingArgs = {
  plan: plan(building),
} satisfies Partial<ProjectSidebarViewProps>;

/** While building: the app is built and up, and its manual is being written. */
export const Building: Story = { args: buildingArgs };

export const BuildingDark: Story = {
  args: buildingArgs,
  globals: { mode: "dark" },
};

/** The files as the room would pass them, the given one opened from them. */
const listed = (
  files: FilesListProps["files"],
  shown: string | null = null,
): FilesListProps => ({ files, shown, onOpen: fn() });

/** The sections at the foot, as the room would pass them. */
const foot = (
  ...sections: SidebarSectionsProps["sections"]
): SidebarSectionsProps => ({ sections, onOpen: fn() });

/** A new project: no files yet, so no Files group, and no app, so no Preview row. */
export const FilesNone: Story = {
  args: { files: listed([]) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("button", { name: words.files }),
    ).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: words.preview }),
    ).toBeNull();
  },
};

/** A small project: its first files under the plan, and no app yet. */
export const FilesSmall: Story = { args: { files: listed(smallFiles) } };

const finishedArgs = {
  plan: { ...plan(building), waitsOn: "build_plan" },
  files: listed(finishedFiles, "build_plan"),
  sections: foot(preview),
} satisfies Partial<ProjectSidebarViewProps>;

/**
 * A finished project, its build plan waiting on the person. The plan and the files mark apart: the
 * build plan opened from the files leaves its step unmarked, and the step opened from the plan
 * stays marked as another file opens.
 */
export const FilesFinished: Story = {
  args: finishedArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const file = canvas.getByRole("treeitem", { name: "Build plan" });
    const step = canvas.getByRole("treeitem", { name: /^Plan the build/ });
    await expect(file).toHaveAttribute("aria-current", "page");
    await expect(step).not.toHaveAttribute("aria-current");
    await userEvent.click(step);
    await expect(step).toHaveAttribute("aria-current", "page");
    const brief = canvas.getByRole("treeitem", { name: "Brief" });
    await userEvent.click(brief);
    await expect(brief).toHaveAttribute("aria-current", "page");
    await expect(file).not.toHaveAttribute("aria-current");
    await expect(step).toHaveAttribute("aria-current", "page");
  },
};

export const FilesFinishedDark: Story = {
  args: finishedArgs,
  globals: { mode: "dark" },
};

// The room lists the filed documents one by one, so the folders and uploads of the files list's own
// stories are not here.
const manyDocuments = largeFiles
  .slice(0, 8)
  .flatMap((each) => (each.opens === null ? each.files : [each]));

/**
 * A project with many documents: the Files group starts folded; opened, it scrolls inside itself
 * while the plan above and the Preview row at the foot stay put.
 */
export const FilesLarge: Story = {
  args: {
    ...buildingArgs,
    files: listed(manyDocuments),
    sections: foot(preview),
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: words.files,
        expanded: false,
      }),
    );
  },
};

/**
 * A long plan scrolls under the project's name, and what stands below it stays at the foot of what
 * scrolls.
 */
export const LongPlan: Story = {
  args: {
    plan: plan([
      row("brief", "Write the brief", "done"),
      row("constraints", "List the constraints", "done"),
      row("approaches", "Compare approaches", "done"),
      row("requirements", "Write the requirements", "done"),
      row("research", "Research other bakeries", "declined"),
      row("design", "Design the screens", "done"),
      row("review", "Review the design", "done"),
      row("build", "Build the app", "running", {}, ran(312)),
      row("orders", "Add online cake orders"),
      row("allergies", "Flag allergies on every order"),
      row("ready", "Tell customers when a cake is ready"),
      row("test", "Test the app with the counter staff"),
      row("manual", "Write the user manual"),
      row("launch", "Launch for the Saturday market"),
    ]),
  },
};

/**
 * Closed, the card holds the project's name, with the toggle that opens it again, and the plan,
 * where the open sidebar has it; the rest of the sidebar waits until it opens.
 */
export const Closed: Story = {
  args: { ...buildingArgs, open: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("tree", { name: words.plan })).toBeVisible();
    await expect(canvas.getAllByRole("treeitem")).toHaveLength(7);
  },
};

export const ClosedDark: Story = {
  args: { ...buildingArgs, open: false },
  globals: { mode: "dark" },
};

/** A step waiting on the person opens what it made, closed as well as open. */
export const ClosedOpensWhatWaitsOnYou: Story = {
  args: { ...finishedArgs, open: false },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("treeitem", { name: /^Plan the build/ }),
    );
    await expect(args.plan.onOpenStep).toHaveBeenCalledWith(
      "build_plan",
      "build_plan",
    );
  },
};

/** Opening and closing grow and shrink the card around the plan, which stays where it is. */
export const PlanStaysPut: Story = {
  args: { ...buildingArgs, open: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const before = canvas.getByRole("tree").getBoundingClientRect();
    await userEvent.click(
      canvas.getByRole("button", { name: "Open the sidebar" }),
    );
    const after = canvas.getByRole("tree").getBoundingClientRect();
    await expect(after.top).toBe(before.top);
    await expect(after.left).toBe(before.left);
    await expect(after.width).toBe(before.width);
  },
};

/** In a narrow room the sidebar is a drawer over the page. */
export const Drawer: Story = {
  args: { ...buildingArgs, drawer: true },
  globals: { viewport: "mobile1" },
};

/** The open drawer goes away on Escape and on a press on the page beside it. */
export const DrawerPutAway: Story = {
  args: { ...buildingArgs, drawer: true },
  globals: { viewport: "mobile1" },
  play: async ({ args, canvasElement }) => {
    await userEvent.keyboard("{Escape}");
    await expect(args.onToggleSidebar).toHaveBeenCalledTimes(1);
    const toggle = within(canvasElement).getByRole("button", {
      name: "Open the sidebar",
      expanded: false,
    });
    await userEvent.click(toggle);
    await userEvent.click(document.body);
    await expect(args.onToggleSidebar).toHaveBeenCalledTimes(3);
  },
};

export const DrawerDark: Story = {
  args: { ...buildingArgs, drawer: true },
  globals: { viewport: "mobile1", mode: "dark" },
};

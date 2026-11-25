import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { FilesListProps } from "./files-list.tsx";
import {
  finishedFiles,
  largeFiles,
  longNamedFiles,
  smallFiles,
} from "./files-list.stories.tsx";
import { building, planning, ran, row } from "./plan-timeline.stories.tsx";
import {
  ProjectSidebarView,
  type ProjectSidebarViewProps,
} from "./project-sidebar.view.tsx";
import type { SidebarSectionsProps } from "./sidebar-sections.tsx";
import { preview, publish } from "./sidebar-sections.stories.tsx";
import { LIVE_TAB } from "./tab-follow.ts";
import { wording } from "../../config.ts";

const words = wording.projectShell;

/**
 * What is on the page and the part it was opened from, which alone marks it: a step, a file, a
 * section, or the app from its own line.
 */
type OnPage = {
  tab: string;
  from: "plan" | "files" | "sections" | "app";
} | null;

const onPageOf = ({
  plan,
  files,
  sections,
}: ProjectSidebarViewProps): OnPage => {
  const section = sections?.sections.find((each) => each.selected);
  if (section !== undefined) return { tab: section.id, from: "sections" };
  if (files !== undefined && files.shown !== null)
    return { tab: files.shown, from: "files" };
  return plan.shown === null ? null : { tab: plan.shown, from: "plan" };
};

// Holds what the page would: what is on the page and whether the sidebar is out, so a story can
// be clicked through.
function Clickable(args: ProjectSidebarViewProps) {
  const [onPage, setOnPage] = useState(() => onPageOf(args));
  const [open, setOpen] = useState(args.open);
  const from = (part: "plan" | "files" | "sections") =>
    onPage !== null && onPage.from === part ? onPage.tab : null;
  const appOpen = onPage?.tab === LIVE_TAB;
  const { plan, files, sections, appLine } = args;
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
        shown: from("plan"),
        onOpenStep: (tab) => {
          setOnPage({ tab, from: "plan" });
          plan.onOpenStep(tab);
        },
      }}
      files={
        files === undefined
          ? undefined
          : {
              ...files,
              shown: from("files"),
              onOpen: (tab) => {
                setOnPage({ tab, from: "files" });
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
                selected: each.id === from("sections"),
              })),
              onOpen: (id) => {
                setOnPage({ tab: id, from: "sections" });
                sections.onOpen(id);
              },
            }
      }
      appLine={
        appLine === null
          ? null
          : {
              ...appLine,
              open: appOpen,
              onOpen: () => {
                setOnPage({ tab: LIVE_TAB, from: "app" });
                appLine.onOpen();
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
  app: ProjectSidebarViewProps["plan"]["app"] = "not_built",
): ProjectSidebarViewProps["plan"] => ({
  plan: steps,
  app,
  shown: null,
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
    appLine: null,
    onToggleSidebar: fn(),
    onHome: fn(),
    onSettings: fn(),
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
  plan: plan(building, "running"),
} satisfies Partial<ProjectSidebarViewProps>;

/** While building: the app is built and up, and its manual is being written. */
export const Building: Story = { args: buildingArgs };

export const BuildingDark: Story = {
  args: buildingArgs,
  globals: { mode: "dark" },
};

/** Without a step that makes it, as when the app came before the plan, the app keeps its own line. */
export const AppWithoutPlan: Story = {
  args: {
    plan: plan([], "running"),
    appLine: { app: "running", open: false, onOpen: fn() },
  },
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

/** A new project: no files yet, so no Files group, and an app not built with nothing to publish. */
export const FilesNone: Story = {
  args: { files: listed([]), sections: foot(preview("Not built")) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("button", { name: words.files }),
    ).toBeNull();
    await expect(canvas.queryByRole("button", { name: /^Publish/ })).toBeNull();
  },
};

/** A small project: its first files under the plan, the sections at the foot. */
export const FilesSmall: Story = {
  args: {
    files: listed(smallFiles),
    sections: foot(preview("Not built"), publish("Not published")),
  },
};

const finishedArgs = {
  ...buildingArgs,
  files: listed(finishedFiles, "build_plan"),
  sections: foot(preview("Running"), publish("Live")),
} satisfies Partial<ProjectSidebarViewProps>;

/**
 * A finished project. The plan, the files and the sections each mark only what was opened from
 * them: the build plan opened from the files leaves its step in the plan unmarked, the step opened
 * next takes the mark from the file, and a section opened after takes it from the step.
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
    await expect(file).not.toHaveAttribute("aria-current");
    const preview = canvas.getByRole("button", { name: /^Preview/ });
    await userEvent.click(preview);
    await expect(preview).toHaveAttribute("aria-current", "page");
    await expect(step).not.toHaveAttribute("aria-current");
  },
};

export const FilesFinishedDark: Story = {
  args: finishedArgs,
  globals: { mode: "dark" },
};

/**
 * A large project: the Files group starts folded; opened, it scrolls inside itself while the plan
 * above and the sections at the foot stay put.
 */
export const FilesLarge: Story = {
  args: {
    ...buildingArgs,
    files: listed(largeFiles),
    sections: foot(preview("Failed", "destructive"), publish("Not published")),
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

/** Long file and folder names are cut short with an ellipsis, nested ones too. */
export const FilesLongNames: Story = {
  args: {
    ...buildingArgs,
    files: listed(longNamedFiles),
    sections: foot(preview("Running"), publish("Live")),
  },
};

/**
 * A long plan scrolls under the project's name, and what stands below it stays at the foot of what
 * scrolls.
 */
export const LongPlan: Story = {
  args: {
    plan: plan(
      [
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
      ],
      "running",
    ),
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

/** A step that has made something opens it, closed as well as open. */
export const ClosedOpensWhatAStepMade: Story = {
  args: { ...buildingArgs, open: false },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("treeitem", { name: /^Design the look/ }),
    );
    await expect(args.plan.onOpenStep).toHaveBeenCalledWith("design");
  },
};

/** Opening and closing grow and shrink the card around the plan, which stays where it is. */
export const PlanStaysPut: Story = {
  args: { ...buildingArgs, open: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const before = canvas.getByRole("tree").getBoundingClientRect();
    await userEvent.click(
      canvas.getByRole("button", { name: "Bakery orders", expanded: false }),
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
      name: "Bakery orders",
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

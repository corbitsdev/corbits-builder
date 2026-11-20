import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import {
  ProjectSidebarView,
  type ProjectSidebarViewProps,
  type SidebarFile,
  type SidebarFileRow,
  type SidebarFileState,
  type SidebarPlanGroup,
  type SidebarStep,
  type SidebarStepState,
} from "./project-sidebar.view.tsx";

const tab = wording.documentTab;
const designName = tab["design"] ?? "design";

const step = (
  id: string,
  name: string,
  state: SidebarStepState = "to_do",
): SidebarStep => ({ id, name, state });

/** A plan of one part: its steps stand on their own, with no heading. */
const onePart = (steps: readonly SidebarStep[]): SidebarPlanGroup[] => [
  { id: "plan", name: "Plan", steps },
];

const row = (
  id: string,
  state: SidebarFileState = "ready",
  name: string = tab[id] ?? id,
  newVersion = false,
): SidebarFileRow => ({ id, name, state, newVersion });

const file = (
  id: string,
  state: SidebarFileState = "ready",
  options: {
    name?: string;
    newVersion?: boolean;
    parts?: readonly SidebarFileRow[];
  } = {},
): SidebarFile => ({
  ...row(id, state, options.name, options.newVersion),
  parts: options.parts ?? [],
});

const planning = onePart([
  step("brief", "Write the brief", "done"),
  step("constraints", "List the constraints", "done"),
  step("approaches", "Compare approaches", "running"),
  step("requirements", "Write the requirements"),
  step("design", "Design the screens"),
  step("build", "Build the app"),
]);

const planningFiles = [
  file("problem_brief"),
  file("constraints", "ready", { newVersion: true }),
  file("approaches", "writing"),
];

/** The design and its rows: the mockup while it is drawn, the draft, and two concepts. */
const design = (mockup: SidebarFileState) =>
  file("design", "ready", {
    parts: [
      row("mockup", mockup, wording.design.mockupTab),
      row("draft", "ready", wording.design.draftBadge),
      row("concept-bold", "ready", wording.design.conceptTab(1, "Bold"), true),
      row("concept-calm", "drawing", wording.design.conceptTab(2, "Calm")),
    ],
  });

const buildingFiles = [
  file("problem_brief"),
  file("constraints"),
  file("approaches"),
  file("product_requirements"),
  file("build_plan"),
  design("ready"),
  file("approval_package"),
  file("menu.pdf", "ready", { name: "Spring menu.pdf" }),
  file("user_manual", "writing"),
];

const building = onePart([
  step("brief", "Write the brief", "done"),
  step("requirements", "Write the requirements", "done"),
  step("design", "Design the screens", "done"),
  step("build", "Build the app", "running"),
  step("manual", "Write the user manual", "running"),
]);

// Holds what the page would: the file on the page and whether the sidebar is out, so a story can
// be clicked through.
function Clickable(args: ProjectSidebarViewProps) {
  const [selected, setSelected] = useState(args.selectedFile);
  const [open, setOpen] = useState(args.open);
  return (
    <ProjectSidebarView
      {...args}
      selectedFile={selected}
      open={open}
      onToggleSidebar={() => {
        setOpen(!open);
        args.onToggleSidebar();
      }}
      onOpenFile={(fileId) => {
        setSelected(fileId);
        args.onOpenFile(fileId);
      }}
    />
  );
}

/** The sidebar stands on the project's ground at the window's full height, beside an empty page. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        height: "100vh",
        background: "var(--card)",
      }}
    >
      {children}
      <div
        style={{
          flex: 1,
          margin: 8,
          borderRadius: "var(--radius-lg)",
          background: "var(--wb-pane)",
          boxShadow: "var(--wb-pane-shadow)",
        }}
      />
    </div>
  );
}

const meta = {
  title: "Screens/Workspace/ProjectSidebar",
  component: ProjectSidebarView,
  parameters: { layout: "fullscreen" },
  args: {
    project: "Bakery orders",
    open: true,
    drawer: false,
    plan: planning,
    files: planningFiles,
    selectedFile: "problem_brief",
    onToggleSidebar: fn(),
    onOpenFile: fn(),
    onProjectSettings: fn(),
    onSecrets: fn(),
    onAllProjects: fn(),
    onNewProject: fn(),
    onWorkspaceSettings: fn(),
    onAccount: fn(),
  },
  render: (args) => (
    <Shell>
      <Clickable {...args} />
    </Shell>
  ),
} satisfies Meta<typeof ProjectSidebarView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * While planning: Plan lists its steps with where each stands, and Files the documents written so
 * far, one with a version not yet looked at and one still being written.
 */
export const Planning: Story = {};

const buildingArgs = {
  plan: building,
  files: buildingFiles,
  selectedFile: "build_plan",
};

/**
 * While building: under the design, its mockup, its draft and its concepts, one still being drawn;
 * an attached file is a row of its own.
 */
export const Building: Story = { args: buildingArgs };

export const BuildingDark: Story = {
  args: buildingArgs,
  globals: { mode: "dark" },
};

/** A new project: no steps and no files yet. */
export const NewProject: Story = {
  args: { plan: [], files: [], selectedFile: null },
};

/** A plan in more than one part: each part's name heads its steps. */
export const PlanInParts: Story = {
  args: {
    plan: [
      {
        id: "understand",
        name: "Understand the bakery",
        steps: [
          step("brief", "Write the brief", "done"),
          step("constraints", "List the constraints", "done"),
        ],
      },
      {
        id: "shape",
        name: "Shape the app",
        steps: [
          step("requirements", "Write the requirements", "needs_you"),
          step("design", "Design the screens"),
        ],
      },
      {
        id: "make",
        name: "Make it",
        steps: [step("build", "Build the app")],
      },
    ],
  },
};

/** Every state a step takes: to do, running, waiting on the person, done, failed, declined. */
export const StepStates: Story = {
  args: {
    plan: onePart([
      step("brief", "Write the brief", "done"),
      step("approaches", "Compare approaches", "running"),
      step("requirements", "Write the requirements", "needs_you"),
      step("design", "Design the screens", "failed"),
      step("research", "Research other bakeries", "declined"),
      step("build", "Build the app"),
    ]),
  },
};

/**
 * Every state a file row takes: ready, open, a new version, waiting on the person, being written,
 * being drawn, failed.
 */
export const FileStates: Story = {
  args: {
    files: [
      file("problem_brief"),
      file("constraints"),
      file("approaches", "ready", { newVersion: true }),
      file("product_requirements", "needs_you"),
      file("build_plan", "writing"),
      design("drawing"),
      file("user_manual", "failed"),
    ],
    selectedFile: "constraints",
  },
};

export const FileStatesDark: Story = {
  args: { ...FileStates.args },
  globals: { mode: "dark" },
};

/** A long file, step and project name are cut short with an ellipsis rather than wrapping. */
export const LongNames: Story = {
  args: {
    project: "Bakery orders and wholesale delivery scheduling",
    plan: onePart([
      step(
        "interviews",
        "Interview the Saturday market stall owners about their orders",
        "running",
      ),
    ]),
    files: [
      file("problem_brief"),
      file("notes", "needs_you", {
        name: "Interview notes from the Saturday market stall owners",
      }),
      file("pricing", "ready", {
        name: "Wholesale pricing tiers for cafés and restaurants",
        newVersion: true,
      }),
    ],
    selectedFile: "pricing",
  },
};

/**
 * Closed, the page takes the whole window; only the project's name floats top left, as the control
 * that opens the sidebar again.
 */
export const Closed: Story = { args: { ...buildingArgs, open: false } };

/**
 * Plan and Files are one tree with one tab stop, which lands on the open file. The arrows move
 * between rows; Left steps out to the file a part sits under, then to Files, then folds it.
 */
export const Keyboard: Story = {
  args: { ...buildingArgs, selectedFile: "mockup" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const mockup = canvas.getByRole("treeitem", {
      name: wording.design.mockupTab,
    });
    while (document.activeElement !== mockup) await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    await expect(
      canvas.getByRole("treeitem", { name: wording.design.draftBadge }),
    ).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(
      canvas.getByRole("treeitem", { name: designName }),
    ).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    const files = canvas.getByRole("treeitem", {
      name: wording.projectShell.files,
    });
    await expect(files).toHaveFocus();
    await expect(files).toHaveAttribute("aria-expanded", "false");
  },
};

/** In a narrow room the sidebar is a drawer over the page. */
export const Drawer: Story = {
  args: { ...buildingArgs, drawer: true },
  globals: { viewport: "mobile1" },
};

export const DrawerDark: Story = {
  args: { ...buildingArgs, drawer: true },
  globals: { viewport: "mobile1", mode: "dark" },
};

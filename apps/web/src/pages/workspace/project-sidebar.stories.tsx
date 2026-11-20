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

/**
 * A step not yet started can be set to ask first; once it runs, neither setting changes. Only an
 * optional step can be declined.
 */
const step = (
  id: string,
  name: string,
  state: SidebarStepState = "to_do",
  settings: Partial<
    Pick<SidebarStep, "askFirst" | "declined" | "goAhead">
  > = {},
): SidebarStep => ({
  id,
  name,
  state,
  askFirst: state === "to_do" || state === "needs_you" ? false : null,
  declined: state === "declined" ? true : null,
  goAhead: false,
  ...settings,
});

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

/** The documents written as prose, which print. */
const written = new Set([
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "build_plan",
]);

const file = (
  id: string,
  state: SidebarFileState = "ready",
  options: {
    name?: string;
    newVersion?: boolean;
    parts?: readonly SidebarFileRow[];
    attached?: boolean;
  } = {},
): SidebarFile => ({
  ...row(id, state, options.name, options.newVersion),
  printable: written.has(id),
  removable: options.attached ?? false,
  parts: options.parts ?? [],
});

const planning = onePart([
  step("brief", "Write the brief", "done"),
  step("constraints", "List the constraints", "done"),
  step("approaches", "Compare approaches", "running"),
  step("requirements", "Write the requirements", "to_do", { askFirst: true }),
  step("research", "Research other bakeries", "to_do", { declined: false }),
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
  file("menu.pdf", "ready", { name: "Spring menu.pdf", attached: true }),
  file("user_manual", "writing"),
];

const building = onePart([
  step("brief", "Write the brief", "done"),
  step("requirements", "Write the requirements", "done"),
  step("design", "Design the screens", "done"),
  step("build", "Build the app", "running"),
  step("manual", "Write the user manual", "running"),
]);

// Holds what the page would: the file or app on the page and whether the sidebar is out, so a
// story can be clicked through.
function Clickable(args: ProjectSidebarViewProps) {
  const [selected, setSelected] = useState(args.selectedFile);
  const [appOpen, setAppOpen] = useState(args.appOpen);
  const [open, setOpen] = useState(args.open);
  return (
    <ProjectSidebarView
      {...args}
      selectedFile={selected}
      appOpen={appOpen}
      open={open}
      onOpenApp={() => {
        setSelected(null);
        setAppOpen(true);
        args.onOpenApp();
      }}
      onToggleSidebar={() => {
        setOpen(!open);
        args.onToggleSidebar();
      }}
      onOpenFile={(fileId) => {
        setSelected(fileId);
        setAppOpen(false);
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
    app: "not_built",
    appOpen: false,
    onToggleSidebar: fn(),
    onOpenFile: fn(),
    onPrintFile: fn(),
    onRemoveFile: fn(),
    onAskFirst: fn(),
    onDecline: fn(),
    onGoAhead: fn(),
    onOpenApp: fn(),
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
  app: "running",
} satisfies Partial<ProjectSidebarViewProps>;

/**
 * While building: under the design, its mockup, its draft and its concepts, one still being drawn;
 * an attached file is a row of its own.
 */
export const Building: Story = { args: buildingArgs };

export const BuildingDark: Story = {
  args: buildingArgs,
  globals: { mode: "dark" },
};

/** The app is starting: Live says so, and Open app shows it starting. */
export const AppStarting: Story = {
  args: { ...buildingArgs, app: "starting" },
};

/**
 * The app is running and on the page: Live is marked as the open file would be. Open app puts it
 * on the page from wherever the person is.
 */
export const AppOpen: Story = {
  args: { ...buildingArgs, selectedFile: null, appOpen: true },
};

/** Nothing runs the app right now; opening it starts it again. */
export const AppStopped: Story = { args: { ...buildingArgs, app: "stopped" } };

/** The app could not start; opening it shows why. */
export const AppFailed: Story = { args: { ...buildingArgs, app: "failed" } };

export const AppFailedDark: Story = {
  args: { ...buildingArgs, app: "failed" },
  globals: { mode: "dark" },
};

/** Open app puts the app on the page and marks Live; no file stays marked. */
export const OpenApp: Story = {
  args: buildingArgs,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: wording.projectShell.openApp }),
    );
    await expect(args.onOpenApp).toHaveBeenCalled();
    await expect(
      canvas.getByRole("treeitem", { name: tab["build_plan"] ?? "" }),
    ).not.toHaveAttribute("aria-current");
  },
};

/** A new project: no steps and no files yet, and no app. */
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

/**
 * A step's menu, opened from the keyboard: Enter on a step opens it. Ask me first is ticked on a
 * step set to ask; Decline shows only on an optional step.
 */
export const StepMenu: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const requirements = canvas.getByRole("treeitem", {
      name: /^Write the requirements/,
    });
    await expect(requirements).toHaveAttribute("aria-haspopup", "menu");
    requirements.focus();
    await userEvent.keyboard("{Enter}");
    const page = within(document.body);
    const askFirst = await page.findByRole("menuitemcheckbox", {
      name: wording.conversation.plan.askFirst,
    });
    await expect(askFirst).toHaveAttribute("aria-checked", "true");
    await expect(
      page.queryByRole("menuitemcheckbox", {
        name: wording.projectShell.decline,
      }),
    ).toBeNull();
    await userEvent.click(askFirst);
    await expect(args.onAskFirst).toHaveBeenCalledWith("requirements", false);
    await expect(requirements).toHaveFocus();
  },
};

/**
 * A step the person asked to be consulted on waits on their go-ahead, which its menu gives first.
 */
export const GoAhead: Story = {
  args: {
    plan: onePart([
      step("brief", "Write the brief", "done"),
      step("requirements", "Write the requirements", "needs_you", {
        askFirst: true,
        goAhead: true,
      }),
      step("design", "Design the screens"),
    ]),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    canvas.getByRole("treeitem", { name: /^Write the requirements/ }).focus();
    await userEvent.keyboard("{Enter}");
    const page = within(document.body);
    await userEvent.click(
      await page.findByRole("menuitem", {
        name: wording.conversation.plan.goAhead,
      }),
    );
    await expect(args.onGoAhead).toHaveBeenCalledWith("requirements");
  },
};

/**
 * An attached file's menu, opened by Shift+F10: Remove from project asks once more before it
 * removes. A written document's menu prints it instead.
 */
export const FileMenu: Story = {
  args: buildingArgs,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const attached = canvas.getByRole("treeitem", { name: "Spring menu.pdf" });
    attached.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const page = within(document.body);
    await userEvent.click(
      await page.findByRole("menuitem", {
        name: wording.projectShell.removeFromProject,
      }),
    );
    await expect(args.onRemoveFile).not.toHaveBeenCalled();
    await expect(
      page.getByRole("menuitem", { name: wording.removeAttachment.confirm }),
    ).toBeVisible();
    await expect(
      page.queryByRole("menuitem", { name: wording.printDocument }),
    ).toBeNull();
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

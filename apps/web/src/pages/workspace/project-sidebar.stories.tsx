import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import {
  ProjectSidebarView,
  type ProjectSidebarViewProps,
  type SidebarPlanGroup,
  type SidebarStep,
  type SidebarStepState,
} from "./project-sidebar.view.tsx";

const words = wording.projectShell;

/**
 * A step not yet started can be set to ask first; once it runs, neither setting changes. Only an
 * optional step can be declined.
 */
const step = (
  id: string,
  name: string,
  state: SidebarStepState = "to_do",
  settings: Partial<Pick<SidebarStep, "askFirst" | "declined">> = {},
): SidebarStep => ({
  id,
  name,
  state,
  askFirst: state === "to_do" || state === "needs_you" ? false : null,
  declined: state === "declined" ? true : null,
  ...settings,
});

/** A plan of one part: its steps stand on their own, with no heading. */
const onePart = (steps: readonly SidebarStep[]): SidebarPlanGroup[] => [
  { id: "plan", name: "Plan", steps },
];

const planning = onePart([
  step("brief", "Write the brief", "done"),
  step("constraints", "List the constraints", "done"),
  step("approaches", "Compare approaches", "running"),
  step("requirements", "Write the requirements", "to_do", { askFirst: true }),
  step("research", "Research other bakeries", "to_do", { declined: false }),
  step("design", "Design the screens"),
  step("build", "Build the app"),
]);

const building = onePart([
  step("brief", "Write the brief", "done"),
  step("requirements", "Write the requirements", "done"),
  step("design", "Design the screens", "done"),
  step("build", "Build the app", "running"),
  step("manual", "Write the user manual", "running"),
]);

// Holds what the page would: whether the app is on the page and whether the sidebar is out, so a
// story can be clicked through.
function Clickable(args: ProjectSidebarViewProps) {
  const [appOpen, setAppOpen] = useState(args.appOpen);
  const [open, setOpen] = useState(args.open);
  return (
    <ProjectSidebarView
      {...args}
      appOpen={appOpen}
      open={open}
      onOpenApp={() => {
        setAppOpen(true);
        args.onOpenApp();
      }}
      onToggleSidebar={() => {
        setOpen(!open);
        args.onToggleSidebar();
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
    app: "not_built",
    appOpen: false,
    onToggleSidebar: fn(),
    onAskFirst: fn(),
    onDecline: fn(),
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
 * While planning: the finished steps are quiet, the one being worked on is the brightest row and
 * turns, and the steps ahead are fainter. There is no app yet.
 */
export const Planning: Story = {};

export const PlanningDark: Story = { globals: { mode: "dark" } };

const buildingArgs = {
  plan: building,
  app: "running",
} satisfies Partial<ProjectSidebarViewProps>;

/** While building: two steps run at once, and the app is up. */
export const Building: Story = { args: buildingArgs };

export const BuildingDark: Story = {
  args: buildingArgs,
  globals: { mode: "dark" },
};

/** The app is starting: its line turns until it is up. */
export const AppStarting: Story = {
  args: { ...buildingArgs, app: "starting" },
};

/** The app is running and on the page: its line is marked. */
export const AppOpen: Story = {
  args: { ...buildingArgs, appOpen: true },
};

/** Nothing runs the app right now; opening it starts it again. */
export const AppStopped: Story = { args: { ...buildingArgs, app: "stopped" } };

/** The app could not start; opening it shows why. */
export const AppFailed: Story = { args: { ...buildingArgs, app: "failed" } };

export const AppFailedDark: Story = {
  args: { ...buildingArgs, app: "failed" },
  globals: { mode: "dark" },
};

/** The app's line opens the app and is marked once it is on the page. */
export const OpenApp: Story = {
  args: buildingArgs,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const line = canvas.getByRole("button", { name: words.appState.running });
    await expect(line).toHaveAttribute("title", words.openApp);
    await userEvent.click(line);
    await expect(args.onOpenApp).toHaveBeenCalled();
    await expect(line).toHaveAttribute("data-current");
  },
};

/** Before there is an app there is no line for it: the plan is all the sidebar holds. */
export const NoApp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTitle(words.openApp)).toBeNull();
  },
};

/** A new project: no steps yet, and no app. */
export const NewProject: Story = { args: { plan: [] } };

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

/** Every state a step takes: done, running, waiting on the person, failed, declined, to do. */
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

export const StepStatesDark: Story = {
  args: { ...StepStates.args },
  globals: { mode: "dark" },
};

/** A long step and project name are cut short with an ellipsis rather than wrapping. */
export const LongNames: Story = {
  args: {
    project: "Bakery orders and wholesale delivery scheduling",
    plan: onePart([
      step(
        "interviews",
        "Interview the Saturday market stall owners about their orders",
        "running",
      ),
      step(
        "pricing",
        "Set wholesale pricing tiers for cafés and restaurants",
        "needs_you",
      ),
    ]),
  },
};

/**
 * A long plan scrolls under the project's name, and the links stay below it, at the foot of what
 * scrolls.
 */
export const LongPlan: Story = {
  args: {
    ...buildingArgs,
    plan: onePart([
      step("brief", "Write the brief", "done"),
      step("constraints", "List the constraints", "done"),
      step("approaches", "Compare approaches", "done"),
      step("requirements", "Write the requirements", "done"),
      step("research", "Research other bakeries", "declined"),
      step("design", "Design the screens", "done"),
      step("review", "Review the design", "done"),
      step("build", "Build the app", "running"),
      step("orders", "Add online cake orders"),
      step("allergies", "Flag allergies on every order"),
      step("ready", "Tell customers when a cake is ready"),
      step("test", "Test the app with the counter staff"),
      step("manual", "Write the user manual"),
      step("launch", "Launch for the Saturday market"),
    ]),
  },
};

/**
 * Closed, the page takes the whole window; only the project's name floats top left, as the control
 * that opens the sidebar again.
 */
export const Closed: Story = { args: { ...buildingArgs, open: false } };

/**
 * The plan is a tree with one tab stop, which lands on Plan. The arrows move between steps; Left
 * steps out to Plan, then folds it, and Right opens it again.
 */
export const Keyboard: Story = {
  args: buildingArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const plan = canvas.getByRole("treeitem", { name: words.plan });
    while (document.activeElement !== plan) await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await expect(
      canvas.getByRole("treeitem", { name: /^Write the requirements/ }),
    ).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(plan).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(plan).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{ArrowRight}");
    await expect(plan).toHaveAttribute("aria-expanded", "true");
  },
};

/**
 * Folded, Plan still says what its steps would: it shimmers while a step runs, and carries the dot
 * while one waits on the person, which says more.
 */
export const FoldedPlan: Story = {
  args: { ...buildingArgs },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const plan = canvas.getByRole("treeitem", { name: words.plan });
    await userEvent.click(within(plan).getByText(words.plan));
    await expect(plan).toHaveAttribute("aria-expanded", "false");
    await expect(plan.querySelector('[data-row="branch"]')).toHaveAttribute(
      "data-state",
      "running",
    );
  },
};

export const FoldedPlanNeedsYou: Story = {
  args: { ...PlanInParts.args },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const plan = canvas.getByRole("treeitem", { name: words.plan });
    await userEvent.click(within(plan).getByText(words.plan));
    await expect(plan.querySelector('[data-row="branch"]')).toHaveAttribute(
      "data-state",
      "needs_you",
    );
  },
};

/**
 * A step's row shows what will happen to it: a step set to pause carries the pause mark, a skipped
 * step is struck through. Its menu, from Enter on the row, says what each choice will do: on a step
 * that pauses, Don't pause; Skip shows only on an optional step.
 */
export const StepMenu: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const requirements = canvas.getByRole("treeitem", {
      name: /^Write the requirements/,
    });
    await expect(requirements).toHaveAccessibleName(
      `Write the requirements, ${words.stepState.to_do}, ${words.pausesFirst}`,
    );
    await expect(requirements).toHaveAttribute("aria-haspopup", "menu");
    requirements.focus();
    await userEvent.keyboard("{Enter}");
    const page = within(document.body);
    const dontPause = await page.findByRole("menuitem", {
      name: words.stepMenu.dontPause,
    });
    await expect(
      page.queryByRole("menuitem", { name: words.stepMenu.skip }),
    ).toBeNull();
    await userEvent.click(dontPause);
    await expect(args.onAskFirst).toHaveBeenCalledWith("requirements", false);
    await expect(requirements).toHaveFocus();
  },
};

/** An optional step's menu offers to skip it; once skipped, it offers to keep it. */
export const SkipMenu: Story = {
  args: {
    plan: onePart([
      step("brief", "Write the brief", "done"),
      step("research", "Research other bakeries", "to_do", { declined: false }),
      step("visit", "Visit the market stalls", "to_do", { declined: true }),
    ]),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const visit = canvas.getByRole("treeitem", {
      name: `Visit the market stalls, ${words.skipped}`,
    });
    visit.focus();
    await userEvent.keyboard("{Enter}");
    const page = within(document.body);
    await userEvent.click(
      await page.findByRole("menuitem", { name: words.stepMenu.keep }),
    );
    await expect(args.onDecline).toHaveBeenCalledWith("visit", false);
    const research = canvas.getByRole("treeitem", {
      name: /^Research other bakeries/,
    });
    research.focus();
    await userEvent.keyboard("{Enter}");
    await expect(
      await page.findByRole("menuitem", { name: words.stepMenu.skip }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: words.stepMenu.pause }),
    ).toBeVisible();
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

import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import {
  ProjectSidebarView,
  type ProjectSidebarViewProps,
  type SidebarRow,
  type SidebarStep,
  type SidebarStepState,
} from "./project-sidebar.view.tsx";
import { LIVE_TAB } from "./tab-follow.ts";

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

/** A step of the plan, a row of its own; it opens what it made once the project has it. */
const row = (
  id: string,
  name: string,
  state: SidebarStepState = "to_do",
  settings: Partial<Pick<SidebarStep, "askFirst" | "declined">> = {},
  fields: Partial<SidebarRow> = {},
): SidebarRow => ({
  id,
  name,
  state,
  app: false,
  opens: null,
  startedAt: null,
  summary: null,
  steps: [step(id, name, state, settings)],
  ...fields,
});

/** A step at work, started the given seconds ago, its run saying what it is doing. */
const ran = (seconds: number, summary: string | null = null) => ({
  startedAt: new Date(Date.now() - seconds * 1000).toISOString(),
  summary,
});

/** A step that has made a document the project view can open, of the given kind. */
const made = (kind: string) => ({ opens: kind });

const planning = [
  row("brief", "Write the brief", "done", {}, made("problem_brief")),
  row("constraints", "List the constraints", "done", {}, made("constraints")),
  row(
    "approaches",
    "Compare approaches",
    "running",
    {},
    ran(94, "Weighing a form, a chat and a calendar"),
  ),
  row("requirements", "Write the requirements", "to_do", { askFirst: true }),
  row("research", "Research other bakeries", "to_do", { declined: false }),
  row("design", "Design the look"),
  row("build", "Build the app", "to_do", {}, { app: true }),
];

const building = [
  row("brief", "Write the brief", "done", {}, made("problem_brief")),
  row(
    "requirements",
    "Write the requirements",
    "done",
    {},
    made("product_requirements"),
  ),
  row("looks", "Choose how many looks", "done"),
  row("design", "Design the look", "done", {}, made("design")),
  row("build_plan", "Plan the build", "done", {}, made("build_plan")),
  row("build", "Build the app", "done", {}, { app: true, opens: LIVE_TAB }),
  row(
    "manual",
    "Write the user manual",
    "running",
    {},
    ran(41, "Writing how to take an order"),
  ),
];

/** Published after the build: a second ready-made plan, one of its steps waiting on the person. */
const publishing = [
  ...building,
  row("ready", "Check your app is ready for Cloudflare", "done"),
  row("where", "Confirm where your app goes", "needs_you"),
  row("go", "Publish the app to Cloudflare"),
  row("live", "Confirm the saved version is the one live"),
];

/**
 * A plan the coordinator wrote from plugin actions, with no ready-made plan: research, a question,
 * then a command-line tool built and tried. None of its steps makes anything the project view
 * opens, so every row only says where its step stands.
 */
const coordinatorPlan = [
  row("look", "Look at how other bakeries take orders", "done"),
  row("compare", "Compare order formats", "done"),
  row("ask", "Ask which format to read", "needs_you"),
  row("tool", "Build the order import tool", "to_do", { askFirst: true }),
  row("try", "Try the tool on last week's orders", "to_do", {
    declined: false,
  }),
];

// Holds what the page would: what is on the page and whether the sidebar is out, so a story can
// be clicked through.
function Clickable(args: ProjectSidebarViewProps) {
  const [appOpen, setAppOpen] = useState(args.appOpen);
  const [shown, setShown] = useState(args.shown);
  const [open, setOpen] = useState(args.open);
  return (
    <ProjectSidebarView
      {...args}
      appOpen={appOpen}
      shown={shown}
      open={open}
      onOpenApp={() => {
        setAppOpen(true);
        setShown(LIVE_TAB);
        args.onOpenApp();
      }}
      onOpenStep={(tab) => {
        setShown(tab);
        setAppOpen(tab === LIVE_TAB);
        args.onOpenStep(tab);
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
    shown: null,
    onToggleSidebar: fn(),
    onHome: fn(),
    onSettings: fn(),
    onOpenApp: fn(),
    onOpenStep: fn(),
    onProjectSettings: fn(),
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
 * While a ready-made plan runs: its steps, with no row for the plan itself. The finished steps
 * are quiet, the one being worked on is the brightest row and turns, and the steps ahead are
 * fainter. There is no app yet.
 */
export const Planning: Story = {};

export const PlanningDark: Story = { globals: { mode: "dark" } };

const buildingArgs = {
  plan: building,
  app: "running",
} satisfies Partial<ProjectSidebarViewProps>;

/** While building: the app is built and up, and its manual is being written. */
export const Building: Story = { args: buildingArgs };

export const BuildingDark: Story = {
  args: buildingArgs,
  globals: { mode: "dark" },
};

/**
 * The build plan opened from the approval waiting in the prompt box: its step is shaded as the one
 * on the page, and says it waits on the person until they answer.
 */
export const DocumentWaitsOnYou: Story = {
  args: { ...buildingArgs, shown: "build_plan", waitsOn: "build_plan" },
  play: async ({ canvasElement }) => {
    const step = within(canvasElement).getByRole("treeitem", {
      name: /^Plan the build/,
    });
    await expect(step).toHaveAttribute("aria-current", "page");
    await expect(step).toHaveAccessibleName(
      `Plan the build, ${words.stepState.needs_you}`,
    );
    await expect(step).toHaveTextContent(words.stepNow.needsYou);
  },
};

export const DocumentWaitsOnYouDark: Story = {
  ...DocumentWaitsOnYou,
  globals: { mode: "dark" },
};

/** The app is starting: its row turns until it is up. */
export const AppStarting: Story = {
  args: { ...buildingArgs, app: "starting" },
};

/** The app is running and on the page: its row is marked. */
export const AppOpen: Story = {
  args: { ...buildingArgs, appOpen: true, shown: LIVE_TAB },
};

/** Nothing runs the app right now; opening it starts it again. */
export const AppStopped: Story = { args: { ...buildingArgs, app: "stopped" } };

/** The app could not start; opening it shows why. */
export const AppFailed: Story = { args: { ...buildingArgs, app: "failed" } };

export const AppFailedDark: Story = {
  args: { ...buildingArgs, app: "failed" },
  globals: { mode: "dark" },
};

/** Where no row makes the app, its own line opens it and is marked once it is on the page. */
export const OpenApp: Story = {
  args: { plan: [], app: "running" },
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

/**
 * No plan, as in a new project or one asked for something too small to plan: the sidebar makes up
 * no row, says in one line that the steps will show there, and the links stay at its foot.
 */
export const NoPlan: Story = {
  args: { plan: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("tree")).toBeNull();
    await expect(canvas.getByText(words.noPlan)).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: words.projectSettings }),
    ).toBeVisible();
  },
};

/**
 * A plan the coordinator wrote itself, its steps mostly making nothing: each is a row of its own,
 * saying only where it stands, and nothing is made up to stand for what they lead to.
 */
export const CoordinatorPlan: Story = {
  args: { plan: coordinatorPlan },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getAllByRole("treeitem");
    await expect(rows.map((item) => item.getAttribute("aria-level"))).toEqual(
      coordinatorPlan.map(() => "1"),
    );
    await expect(
      canvas.getByRole("treeitem", { name: /^Ask which format to read/ }),
    ).toHaveAccessibleName(
      `Ask which format to read, ${words.stepState.needs_you}`,
    );
  },
};

export const CoordinatorPlanDark: Story = {
  args: { plan: coordinatorPlan },
  globals: { mode: "dark" },
};

/** Two ready-made plans' steps, one after the other: the step waiting on the person is shaded. */
export const Publishing: Story = { args: { plan: publishing, app: "running" } };

export const PublishingDark: Story = {
  args: { plan: publishing, app: "running" },
  globals: { mode: "dark" },
};

/** Without a row that makes it, as when the app came before the plan, the app keeps its own line. */
export const AppWithoutPlan: Story = { args: { plan: [], app: "running" } };

/** Every state a step takes: done, running, waiting on the person, failed, declined, to do. */
export const StepStates: Story = {
  args: {
    plan: [
      row("brief", "Write the brief", "done"),
      row(
        "approaches",
        "Compare approaches",
        "running",
        {},
        ran(154, "Weighing a form, a chat and a calendar"),
      ),
      row("requirements", "Write the requirements", "needs_you"),
      row(
        "design",
        "Design the screens",
        "failed",
        {},
        {
          summary: "No colours were chosen",
        },
      ),
      row("research", "Research other bakeries", "declined"),
      row("build", "Build the app"),
    ],
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
    plan: [
      row(
        "interviews",
        "Interview the Saturday market stall owners about their orders",
        "running",
        {},
        ran(
          3725,
          "Writing up what the stall owners said about Saturday orders",
        ),
      ),
      row(
        "pricing",
        "Set wholesale pricing tiers for cafés and restaurants",
        "needs_you",
      ),
    ],
  },
};

/**
 * A long plan scrolls under the project's name, and the links stay below it, at the foot of what
 * scrolls.
 */
export const LongPlan: Story = {
  args: {
    ...buildingArgs,
    plan: [
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
    await expect(
      canvas.queryByRole("button", { name: words.projectSettings }),
    ).toBeNull();
  },
};

/** The mark opens a menu, from the keyboard too, back to the projects or to Settings. */
export const MarkMenu: Story = {
  play: async ({ args, canvasElement }) => {
    within(canvasElement).getByRole("button", { name: words.menu }).focus();
    await userEvent.keyboard("{Enter}");
    const menu = within(document.body);
    await expect(
      menu.getByRole("menuitem", { name: words.settings }),
    ).toBeVisible();
    await userEvent.click(
      menu.getByRole("menuitem", { name: words.backToProjects }),
    );
    await expect(args.onHome).toHaveBeenCalled();
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
    await expect(args.onOpenStep).toHaveBeenCalledWith("design");
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

/**
 * The list is a tree with one tab stop, which lands on its first row. The arrows move between rows,
 * and Home and End jump to either end.
 */
export const Keyboard: Story = {
  args: buildingArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("treeitem", { name: /^Write the brief/ });
    while (document.activeElement !== first) await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    await expect(
      canvas.getByRole("treeitem", { name: /^Write the requirements/ }),
    ).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect(
      canvas.getByRole("treeitem", { name: /^Write the user manual/ }),
    ).toHaveFocus();
    await userEvent.keyboard("{Home}");
    await expect(first).toHaveFocus();
  },
};

/**
 * Steps still ahead show only their names. A skipped step says so under its name, and the row's
 * accessible name says which step will pause before it starts.
 */
export const StepsBeforeTheyStart: Story = {
  args: {
    plan: [
      row("brief", "Write the brief", "done"),
      row(
        "approaches",
        "Compare approaches",
        "running",
        {},
        ran(94, "Weighing a form, a chat and a calendar"),
      ),
      row("requirements", "Write the requirements", "to_do", {
        askFirst: true,
      }),
      row("research", "Research other bakeries", "to_do", { declined: false }),
      row("visit", "Visit the market stalls", "declined", { declined: true }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("treeitem", { name: /^Write the requirements/ }),
    ).toHaveAccessibleName(
      `Write the requirements, ${words.stepState.to_do}, ${words.pausesFirst}`,
    );
    await expect(
      canvas.getByRole("treeitem", {
        name: `Visit the market stalls, ${words.skipped}`,
      }),
    ).toHaveTextContent(/^Visit the market stalls$/);
    await expect(canvas.queryByRole("switch", { hidden: true })).toBeNull();
    await expect(
      within(
        canvas.getByRole("treeitem", { name: /^Compare approaches/ }),
      ).getByText(/^\d+:\d{2}$/),
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

/**
 * A step that has made something opens it, and is marked while it is on the page; the step that
 * built the app opens the app. A step with nothing to show, or the group over it, is only where the
 * work stands, and pressing it does nothing.
 */
export const OpensWhatARowMade: Story = {
  args: buildingArgs,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const requirements = canvas.getByRole("treeitem", {
      name: /^Write the requirements/,
    });
    await userEvent.click(requirements);
    await expect(args.onOpenStep).toHaveBeenCalledWith("product_requirements");
    await expect(requirements).toHaveAttribute("aria-current", "page");
    await userEvent.click(
      canvas.getByRole("treeitem", { name: /^Write the user manual/ }),
    );
    await userEvent.click(
      canvas.getByRole("treeitem", { name: /^Choose how many looks/ }),
    );
    await expect(args.onOpenStep).toHaveBeenCalledTimes(1);
    const app = canvas.getByRole("treeitem", { name: /^Build the app/ });
    await expect(app).toHaveAccessibleName(
      `Build the app, ${words.stepState.done}, ${words.appNow.running}`,
    );
    await userEvent.click(app);
    await expect(args.onOpenStep).toHaveBeenLastCalledWith(LIVE_TAB);
    await expect(app).toHaveAttribute("aria-current", "page");
  },
};

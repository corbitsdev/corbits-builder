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

// What each row of the stories makes, which its icon shows.
const KINDS: Record<string, string> = {
  brief: "problem_brief",
  constraints: "constraints",
  approaches: "approaches",
  requirements: "product_requirements",
  research: "research",
  design: "design_option",
  build_plan: "build_plan",
  build: "app",
  manual: "user_manual",
};

/** A thing the project makes, made by one step of the same name; it opens what it made once it has. */
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
  doing: null,
  app: false,
  makes: KINDS[id] ?? null,
  opens: null,
  steps: [step(id, name, state, settings)],
  ...fields,
});

const planning = [
  row("brief", "Brief", "done", {}, { opens: "problem_brief" }),
  row("constraints", "Constraints", "done", {}, { opens: "constraints" }),
  row("approaches", "Approaches", "running"),
  row("requirements", "Requirements", "to_do", { askFirst: true }),
  row("research", "Research", "to_do", { declined: false }),
  row("design", "Design"),
  row("build", "App", "to_do", {}, { app: true }),
];

const building = [
  row("brief", "Brief", "done", {}, { opens: "problem_brief" }),
  row(
    "requirements",
    "Requirements",
    "done",
    {},
    { opens: "product_requirements" },
  ),
  row(
    "design",
    "Design",
    "done",
    {},
    {
      opens: "design",
      steps: [
        step("looks", "Choose how many looks", "done"),
        step("design", "Design the look", "done"),
      ],
    },
  ),
  row("build_plan", "Build plan", "done", {}, { opens: "build_plan" }),
  row("build", "App", "done", {}, { app: true, opens: LIVE_TAB }),
  row("manual", "User manual", "running"),
];

/** Published after the build: one row for the whole ready-made plan, saying what waits on the person. */
const publishing = [
  ...building,
  row(
    "publish",
    "Published on Cloudflare",
    "needs_you",
    {},
    {
      doing: "Confirm where your app goes",
      steps: [
        step("ready", "Check your app is ready for Cloudflare", "done"),
        step("where", "Confirm where your app goes", "needs_you"),
        step("go", "Publish the app to Cloudflare"),
        step("live", "Confirm the saved version is the one live"),
      ],
    },
  ),
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
    onAskFirst: fn(),
    onDecline: fn(),
    onOpenApp: fn(),
    onOpenStep: fn(),
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

/** While building: the app is built and up, and its manual is being written. */
export const Building: Story = { args: buildingArgs };

export const BuildingDark: Story = {
  args: buildingArgs,
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

/** A new project: no steps yet, and no app. */
export const NewProject: Story = { args: { plan: [] } };

/**
 * A ready-made plan whose steps make nothing of their own until its end is one row, named for what
 * it makes, saying under its name what waits on the person.
 */
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
      row("approaches", "Compare approaches", "running"),
      row("requirements", "Write the requirements", "needs_you"),
      row("design", "Design the screens", "failed"),
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
      row("build", "Build the app", "running"),
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
 * Closed, the page takes the whole window; only the project's name floats top left, as the control
 * that opens the sidebar again.
 */
export const Closed: Story = { args: { ...buildingArgs, open: false } };

/**
 * The list is a tree with one tab stop, which lands on its first row. The arrows move between rows,
 * and Home and End jump to either end.
 */
export const Keyboard: Story = {
  args: buildingArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("treeitem", { name: /^Brief/ });
    while (document.activeElement !== first) await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    await expect(
      canvas.getByRole("treeitem", { name: /^Requirements/ }),
    ).toHaveFocus();
    await userEvent.keyboard("{End}");
    await expect(
      canvas.getByRole("treeitem", { name: /^User manual/ }),
    ).toHaveFocus();
    await userEvent.keyboard("{Home}");
    await expect(first).toHaveFocus();
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
      name: /^Requirements/,
    });
    await expect(requirements).toHaveAccessibleName(
      `Requirements, ${words.stepState.to_do}, ${words.pausesFirst}`,
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
    plan: [
      row("brief", "Write the brief", "done"),
      row("research", "Research other bakeries", "to_do", { declined: false }),
      row("visit", "Visit the market stalls", "declined", { declined: true }),
    ],
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

/**
 * A row whose thing is made opens it, and is marked while it is on the page; the app's row opens
 * the app. One with nothing to show yet is only where the work stands, and pressing it does
 * nothing.
 */
export const OpensWhatARowMade: Story = {
  args: buildingArgs,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const requirements = canvas.getByRole("treeitem", {
      name: /^Requirements/,
    });
    await userEvent.click(requirements);
    await expect(args.onOpenStep).toHaveBeenCalledWith("product_requirements");
    await expect(requirements).toHaveAttribute("aria-current", "page");
    await userEvent.click(
      canvas.getByRole("treeitem", { name: /^User manual/ }),
    );
    await expect(args.onOpenStep).toHaveBeenCalledTimes(1);
    const app = canvas.getByRole("treeitem", { name: /^App/ });
    await expect(app).toHaveAccessibleName(
      `App, ${words.stepState.done}, ${words.appNow.running}`,
    );
    await userEvent.click(app);
    await expect(args.onOpenStep).toHaveBeenLastCalledWith(LIVE_TAB);
    await expect(app).toHaveAttribute("aria-current", "page");
  },
};

/**
 * A row covering several steps says what waits on the person under its name, and its menu names
 * each step whose settings it changes.
 */
export const RowOfSeveralSteps: Story = {
  args: {
    plan: [
      row(
        "design",
        "Design",
        "to_do",
        {},
        {
          steps: [
            step("looks", "Choose how many looks", "to_do", {
              declined: false,
            }),
            step("design", "Design the look", "to_do", { askFirst: true }),
          ],
        },
      ),
    ],
  },
  play: async ({ args, canvasElement }) => {
    const design = within(canvasElement).getByRole("treeitem", {
      name: /^Design/,
    });
    design.focus();
    await userEvent.keyboard("{Enter}");
    const page = within(document.body);
    await userEvent.click(
      await page.findByRole("menuitem", {
        name: words.stepMenu.skipStep("Choose how many looks"),
      }),
    );
    await expect(args.onDecline).toHaveBeenCalledWith("looks", true);
  },
};

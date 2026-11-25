import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { wording } from "../../config.ts";
import {
  PlanTimeline,
  type PlanTimelineProps,
  type SidebarRow,
  type SidebarStep,
  type SidebarStepState,
} from "./plan-timeline.tsx";
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
export const row = (
  id: string,
  name: string,
  state: SidebarStepState = "to_do",
  settings: Partial<Pick<SidebarStep, "askFirst" | "declined">> = {},
  fields: Partial<SidebarRow> = {},
): SidebarRow => ({
  id,
  name,
  state,
  opens: null,
  startedAt: null,
  summary: null,
  steps: [step(id, name, state, settings)],
  ...fields,
});

/** A step at work, started the given seconds ago, its run saying what it is doing. */
export const ran = (seconds: number, summary: string | null = null) => ({
  startedAt: new Date(Date.now() - seconds * 1000).toISOString(),
  summary,
});

/** A step that has made a document the project view can open, of the given kind. */
const made = (kind: string) => ({ opens: kind });

export const planning = [
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
  row("build", "Build the app", "to_do"),
];

export const building = [
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
  row("build", "Build the app", "done", {}, { opens: LIVE_TAB }),
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

// Holds what the page would: the step opened from the plan, so a story can be clicked through.
function Clickable(args: PlanTimelineProps) {
  const [selected, setSelected] = useState(args.selected);
  return (
    <PlanTimeline
      {...args}
      selected={selected}
      onOpenStep={(step, tab) => {
        setSelected(step);
        args.onOpenStep(step, tab);
      }}
    />
  );
}

const meta = {
  title: "Screens/Workspace/ProjectSidebar/Plan",
  component: PlanTimeline,
  args: {
    plan: planning,
    selected: null,
    waitsOn: null,
    onOpenStep: fn(),
  },
  // On the card's ground, at the card's width less its padding.
  render: (args) => (
    <div
      style={{
        width: "calc(var(--rail-width) - 2 * var(--space-2))",
        padding: "var(--space-2)",
        background: "var(--card)",
      }}
    >
      <Clickable {...args} />
    </div>
  ),
} satisfies Meta<typeof PlanTimeline>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * While a ready-made plan runs: its steps, with no row for the plan itself. The finished steps
 * are quiet, the one being worked on is the brightest row with its circle half filled, and the
 * steps ahead are fainter.
 */
export const Planning: Story = {};

export const PlanningDark: Story = { globals: { mode: "dark" } };

const buildingArgs = {
  plan: building,
} satisfies Partial<PlanTimelineProps>;

/** While building: the app is built and up, and its manual is being written. */
export const Building: Story = { args: buildingArgs };

export const BuildingDark: Story = {
  args: buildingArgs,
  globals: { mode: "dark" },
};

/**
 * The build plan opened from the approval waiting in the prompt box: its step says it waits on the
 * person until they answer, and is shaded once opened from the plan.
 */
export const DocumentWaitsOnYou: Story = {
  args: { ...buildingArgs, selected: "build_plan", waitsOn: "build_plan" },
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

/**
 * No plan, as in a new project or one asked for something too small to plan: the plan makes up
 * no row and says in one line that the steps will show there.
 */
export const NoPlan: Story = {
  args: { plan: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("tree")).toBeNull();
    await expect(canvas.getByText(words.noPlan)).toBeVisible();
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
export const Publishing: Story = { args: { plan: publishing } };

export const PublishingDark: Story = {
  args: { plan: publishing },
  globals: { mode: "dark" },
};

/**
 * A step whose work stopped is not drawn as an error: it waits on the person, half filled in the
 * text's colour with one "Waiting on you" line, also where what it made waits in the prompt box.
 * Only its name for a screen reader says it stopped.
 */
export const StoppedStep: Story = {
  args: {
    plan: [
      row("brief", "Write the brief", "done"),
      row(
        "design",
        "Design the screens",
        "failed",
        {},
        { opens: "design", summary: "No colours were chosen" },
      ),
    ],
    waitsOn: "design",
  },
  play: async ({ canvasElement }) => {
    const step = within(canvasElement).getByRole("treeitem", {
      name: `Design the screens, ${words.stepState.failed}, ${words.stepState.needs_you}`,
    });
    await expect(step).toHaveAttribute("data-state", "needs_you");
    await expect(
      within(step).getAllByText(words.stepNow.needsYou),
    ).toHaveLength(1);
  },
};

/** Every state a step takes: done, running, waiting on the person, stopped, declined, to do. */
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

/** A long step name is cut short with an ellipsis rather than wrapping. */
export const LongNames: Story = {
  args: {
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
 * The plan is a tree with one tab stop, which lands on its first step. The arrows move between
 * steps, and Home and End jump to either end.
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
    ).toHaveTextContent(`Visit the market stalls${words.stepNow.skipped}`);
    await expect(canvas.queryByRole("switch", { hidden: true })).toBeNull();
    await expect(
      within(
        canvas.getByRole("treeitem", { name: /^Compare approaches/ }),
      ).getByText(/^\d+:\d{2}$/),
    ).toBeVisible();
  },
};

/**
 * Only a step waiting on the person opens what it made, and is marked once opened. Every other
 * step, done or at work, is only where the work stands, and pressing it does nothing.
 */
export const OpensWhatWaitsOnYou: Story = {
  args: { ...buildingArgs, waitsOn: "build_plan" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("treeitem", { name: /^Write the requirements/ }),
    );
    await userEvent.click(
      canvas.getByRole("treeitem", { name: /^Build the app/ }),
    );
    await userEvent.click(
      canvas.getByRole("treeitem", { name: /^Write the user manual/ }),
    );
    await expect(args.onOpenStep).not.toHaveBeenCalled();
    const waiting = canvas.getByRole("treeitem", { name: /^Plan the build/ });
    await userEvent.click(waiting);
    await expect(args.onOpenStep).toHaveBeenCalledWith(
      "build_plan",
      "build_plan",
    );
    await expect(waiting).toHaveAttribute("aria-current", "page");
  },
};

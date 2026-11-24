import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import {
  type PlanView,
  type PlanViewChild,
  stepFinished,
} from "@corbits-builder/schemas/plan";
import { PlanPanel } from "./plan-panel.tsx";

type State = PlanViewChild["state"];

const started = new Date(Date.now() - 95_000).toISOString();

const step = (
  id: string,
  title: string,
  state: State,
  more: Partial<
    Pick<PlanViewChild, "optional" | "askFirst" | "approval" | "summary">
  > = {},
): PlanViewChild => {
  const made: PlanViewChild = {
    id,
    title,
    plugin: "writer",
    action: "write",
    input: {},
    askFirst: more.askFirst === true,
    state,
    finished: stepFinished(state),
    kind: "workflow",
  };
  if (more.optional !== undefined) made.optional = more.optional;
  if (more.approval !== undefined) made.approval = more.approval;
  if (more.summary !== undefined) made.summary = more.summary;
  if (state === "running") made.startedAt = started;
  return made;
};

// Every state a step can stand in, in the order a plan meets them.
const everyState: PlanView["steps"] = [
  step("brief", "Write the problem brief", "done"),
  step("limits", "Write the constraints", "failed", {
    summary: "The writer stopped: the model provider refused the request.",
  }),
  step("design", "Design the screens", "running"),
  step("approve", "Approve the requirements", "needs_you", {
    approval: { of: ["product_requirements"], when: "required" },
  }),
  step("plan", "Write the build plan", "waiting"),
  step("build", "Build the app", "not_started"),
  step("manual", "Write a user manual", "skipped", { optional: true }),
  step("publish", "Publish the app", "cancelled"),
];

const meta = {
  title: "Screens/Workspace/PlanPanel",
  component: PlanPanel,
  parameters: { layout: "fullscreen" },
  args: {
    steps: everyState,
    drawer: false,
    onHide: fn(),
    onDecline: fn(() => Promise.resolve()),
    onGoAhead: fn(() => Promise.resolve()),
    onAskFirst: fn(() => Promise.resolve()),
  },
  decorators: [
    (Story) => (
      <div
        style={{ display: "flex", justifyContent: "flex-end", height: "100vh" }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PlanPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One step in each state: done, failed, running, waiting on the person, waiting, to do, skipped, cancelled. */
export const EveryState: Story = {};

/** The person asked to be consulted first, and the step now waits on their go-ahead. */
export const WaitingOnYou: Story = {
  args: {
    steps: [
      step("brief", "Write the problem brief", "done"),
      step("build", "Build the app", "needs_you", { askFirst: true }),
      step("manual", "Write a user manual", "not_started", { optional: true }),
    ],
  },
};

// Seven steps done, the eighth under way, the rest to come.
const longState = (index: number): State => {
  if (index < 7) return "done";
  if (index === 7) return "running";
  return "not_started";
};

/** A ready-made plan's long run of steps, its group standing in for none of them. */
export const Long: Story = {
  args: {
    steps: [
      {
        id: "web-app",
        title: "Build a web app from an idea",
        plan: "build-web-app",
        state: "running",
        finished: false,
        steps: [
          "Write the problem brief",
          "Write the constraints",
          "Compare the approaches",
          "Write the product requirements",
          "Approve the requirements",
          "Choose how many looks",
          "Design the screens",
          "Choose a design",
          "Write the build plan",
          "Approve the build plan",
          "Build the app",
          "Check the build",
          "Write a user manual",
          "Publish the app",
        ].map((title, index) =>
          step(`s${String(index)}`, title, longState(index), {
            optional: title === "Write a user manual",
          }),
        ),
      },
    ],
  },
};

/** In a narrow room the plan lies over the conversation. */
export const Drawer: Story = { args: { drawer: true } };

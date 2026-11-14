import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, ActivityContent, type PartTool } from "@corbits/react-ui";
import { fn } from "storybook/test";
import {
  WorkUnitStepView,
  type WorkUnitStepViewProps,
} from "./work-unit-step.view.tsx";

const step = (id: string, name: string, done = true): PartTool => ({
  kind: "tool-trace",
  toolCallId: id,
  name,
  status: done ? "output-available" : "running",
});

// The writer's calls on Constraints, as its run's stream named them, the newest still running.
const STEPS: readonly PartTool[] = [
  step("call-1", "Reading the problem brief"),
  step("call-2", "Reading the approaches"),
  step("call-3", "Writing the constraints", false),
];
const done = STEPS.map((item) => step(item.toolCallId, item.name));

const args: WorkUnitStepViewProps = {
  unitKey: "call-writer",
  status: { state: "starting" },
  label: "Writer · Writing the constraints",
  steps: [],
  preview: undefined,
  instruction: undefined,
  report: undefined,
  document: undefined,
  onOpenDocument: fn(),
  watch: undefined,
  stop: undefined,
  // The thread draws the steps as its own list of them; the library's list stands in for it here.
  run: (steps) => (
    <Activity steps={steps} open>
      <ActivityContent />
    </Activity>
  ),
};

const meta = {
  title: "Screens/Workspace/WorkUnit",
  component: WorkUnitStepView,
  args,
} satisfies Meta<typeof WorkUnitStepView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Starting: Story = {};

/** At work: every step it took so far, the newest last and still running. */
export const Working: Story = {
  args: {
    status: {
      state: "working",
      since: new Date(Date.now() - 95_000).toISOString(),
    },
    steps: STEPS,
  },
};

/** A designer at work offers to open its draft as it takes shape, beside its name. */
export const WatchingADesigner: Story = {
  args: {
    status: {
      state: "working",
      since: new Date(Date.now() - 95_000).toISOString(),
    },
    label: "Designer · Making a mockup",
    steps: STEPS,
    watch: { label: "Watch the draft", open: fn() },
  },
};

/** The run is held on a request only the person can approve. */
export const PausedForApproval: Story = {
  args: {
    status: { state: "approval", asked: "installing zod, exceljs" },
    steps: STEPS,
  },
};

/** The work filed its document, shown first under the row with its summary, then how it went. */
export const Ready: Story = {
  args: {
    status: {
      state: "ready",
      title: "Constraints",
      version: 1,
      kind: "constraints",
    },
    label: "Writer · Wrote the constraints",
    steps: done,
    document: {
      kind: "constraints",
      title: "Constraints",
      version: 1,
      summary:
        "- **One counter tablet** takes every order.\n- No customer accounts.",
      onOpen: fn(),
    },
    report:
      "Filed the **constraints**: one counter tablet, no customer accounts.",
  },
};

/** The run ended without filing what it was asked for. */
export const Finished: Story = {
  args: { status: { state: "finished" }, steps: done },
};

export const Failed: Story = {
  args: {
    status: {
      state: "failed",
      reason: "the model provider refused the request",
    },
    steps: done,
  },
};

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
  label: "Writing the constraints",
  steps: [],
  preview: undefined,
  instruction: undefined,
  report: undefined,
  document: undefined,
  onOpenDocument: fn(),
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

/** At work between steps: its live slot shows, its steps folded until opened. */
export const Working: Story = {
  args: {
    status: {
      state: "working",
      since: new Date(Date.now() - 95_000).toISOString(),
    },
    steps: STEPS,
    preview: { kind: "waiting" },
  },
};

/** A designer making its first mockup shows its one working row and offers nothing to open. */
export const DesignerMakingTheMockup: Story = {
  args: {
    status: {
      state: "working",
      since: new Date(Date.now() - 95_000).toISOString(),
    },
    label: "Making a mockup",
    steps: STEPS,
    preview: { kind: "waiting" },
  },
};

/** The first mockup is filed: the row offers to open it, as it does for a ready document. */
export const DesignerMockupReady: Story = {
  args: {
    status: { state: "ready", title: "Design", version: 1, kind: "design" },
    label: "Made the mockup",
    steps: done,
    onOpenDocument: fn(),
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
    label: "Wrote the constraints",
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

/** The person stopped the run. */
export const Stopped: Story = {
  args: { status: { state: "stopped" }, steps: done },
};

/** The run says what stops it, in its own words, for the person to deal with. */
export const Blocked: Story = {
  args: {
    status: {
      state: "blocked",
      reason:
        "The project's checks need a Stripe test key, which is not set in this deployment.",
    },
    steps: done,
  },
};

/** Held on a long request: on a phone the title keeps its line and the request wraps beneath. */
export const PausedOnALongRequest: Story = {
  args: {
    status: {
      state: "approval",
      asked: "installing zod, exceljs, date-fns and @tanstack/react-table",
    },
    label: "Building the order screen",
    steps: STEPS,
  },
};

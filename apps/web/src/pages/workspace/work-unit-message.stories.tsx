import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Activity,
  Conversation,
  ConversationContent,
  type PartTool,
} from "@corbits/react-ui";
import { fn } from "storybook/test";
import type { DocumentApproval } from "./transcript.tsx";
import {
  WorkUnitMessageView,
  type WorkUnitMessageViewProps,
} from "./work-unit-message.view.tsx";

const install: DocumentApproval = {
  approvalId: "approval-1",
  toolName: "install_packages",
  packages: ["date-fns"],
};

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

const args: WorkUnitMessageViewProps = {
  unitKey: "call-writer",
  status: { state: "starting" },
  role: "writer",
  subject: "Constraints",
  steps: [],
  preview: undefined,
  report: undefined,
  approvals: [],
  onOpenDocument: fn(),
  watch: undefined,
  // The thread draws the steps as its own run of them; the library's run stands in for it here.
  run: (steps, inProgress) => (
    <Activity steps={steps} defaultOpen={inProgress} />
  ),
  // The thread draws each approval as its own card; a line stands in for it here.
  decision: (approval) => (
    <p>Approval card for {approval.packages?.join(", ")}</p>
  ),
};

const meta = {
  title: "Screens/Workspace/WorkUnit",
  component: WorkUnitMessageView,
  args,
  // A thread item registers with the conversation around it.
  decorators: [
    (Story) => (
      <Conversation>
        <ConversationContent>
          <Story />
        </ConversationContent>
      </Conversation>
    ),
  ],
} satisfies Meta<typeof WorkUnitMessageView>;

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

/** A designer at work offers to open its draft as it takes shape. */
export const WatchingADesigner: Story = {
  args: {
    status: {
      state: "working",
      since: new Date(Date.now() - 95_000).toISOString(),
    },
    role: "designer",
    subject: "the design",
    steps: STEPS,
    watch: { label: "Watch the draft", open: fn() },
  },
};

/** The run is held on a request only the person can approve. */
export const PausedForApproval: Story = {
  args: {
    status: { state: "approval" },
    steps: STEPS,
    approvals: [install],
  },
};

/** The work filed its document, which the result line opens, under its folded steps. */
export const Ready: Story = {
  args: {
    status: {
      state: "ready",
      title: "Constraints",
      version: 1,
      kind: "constraints",
    },
    steps: done,
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

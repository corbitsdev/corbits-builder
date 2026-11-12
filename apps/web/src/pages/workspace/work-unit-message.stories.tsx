import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Conversation,
  ConversationContent,
  Tool,
  ToolHeader,
  ToolInput,
  type ConversationMessage,
  type ConversationPart,
} from "@corbits/react-ui";
import { fn } from "storybook/test";
import type { DispatchStatus } from "./dispatch-card.tsx";
import type { DocumentApproval } from "./transcript.tsx";
import {
  WorkUnitMessageView,
  type WorkUnitMessageViewProps,
} from "./work-unit-message.view.tsx";

const HANDOFF = "call-1";
const REPORTS = [
  "Read the problem brief and the three approaches.",
  "Filed the **constraints**: one counter tablet, no customer accounts.",
];
const install: DocumentApproval = {
  approvalId: "approval-1",
  toolName: "install_packages",
  packages: ["date-fns"],
};

// The writer's work on Constraints as one message: the hand-off, its reports, where it stands,
// then the approvals it asked for.
function message(
  status: DispatchStatus,
  reports: readonly string[],
  approvals: readonly DocumentApproval[] = [],
): ConversationMessage {
  const parts: ConversationPart[] = [
    {
      kind: "tool-trace",
      toolCallId: HANDOFF,
      name: "Asked the writer for Constraints",
      status: "output-available",
      input: "Write the constraints from the approved problem brief.",
    },
    ...reports.map((text, index): ConversationPart => ({
      kind: "tool-trace",
      toolCallId: `${HANDOFF}:report:${String(index)}`,
      name: text.replaceAll("*", ""),
      status: "output-available",
      output: text,
    })),
    { kind: "block", block: { type: "work-result", data: status } },
    ...approvals.map((approval): ConversationPart => ({
      kind: "tool-trace",
      toolCallId: approval.approvalId,
      name: "",
      status: "approval-requested",
      approval: {
        id: approval.approvalId,
        status: "pending",
        scope: null,
        timeoutAt: null,
      },
    })),
  ];
  return {
    id: "work:call-1",
    author: {
      id: "writer",
      kind: "agent",
      name: "Writer",
      role: "Constraints",
    },
    at: "2026-03-07T09:00:00.000Z",
    status:
      status.state === "starting" || status.state === "working"
        ? "streaming"
        : "sent",
    parts,
  };
}

const standing = (
  status: DispatchStatus,
  reports: readonly string[] = [],
): Pick<WorkUnitMessageViewProps, "status" | "message"> => ({
  status,
  message: message(status, reports),
});

const args: WorkUnitMessageViewProps = {
  ...standing({ state: "starting" }),
  handoffStep: HANDOFF,
  role: "writer",
  subject: "Constraints",
  doing: "Working on Constraints",
  recent: [],
  preview: undefined,
  report: undefined,
  refused: false,
  approvals: [],
  onOpenDocument: fn(),
  watch: undefined,
  // The thread draws the hand-off's own step as a call that opens onto its instruction.
  handoff: (step) =>
    step.kind === "tool-trace" ? (
      <Tool part={{ ...step, name: "" }}>
        <ToolHeader label={step.name} />
        <ToolInput title="Instruction" />
      </Tool>
    ) : null,
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

/** At work: what the run is doing now, for how long, and the steps it took just before. */
export const Working: Story = {
  args: {
    ...standing(
      {
        state: "working",
        since: new Date(Date.now() - 95_000).toISOString(),
      },
      REPORTS.slice(0, 1),
    ),
    doing: "Reading the problem brief",
    recent: ["Reading the constraints", "Searching the approaches"],
  },
};

/** A designer at work offers to open its draft as it takes shape. */
export const WatchingADesigner: Story = {
  args: {
    ...standing({
      state: "working",
      since: new Date(Date.now() - 95_000).toISOString(),
    }),
    role: "designer",
    subject: "the design",
    doing: "Writing the home page",
    watch: { label: "Watch the draft", open: fn() },
  },
};

/** The run is held on a request only the person can approve. */
export const PausedForApproval: Story = {
  args: {
    status: { state: "approval" },
    message: message({ state: "approval" }, REPORTS.slice(0, 1), [install]),
    approvals: [install],
  },
};

/** The work filed its document, which the result line opens. */
export const Ready: Story = {
  args: standing(
    { state: "ready", title: "Constraints", version: 1, kind: "constraints" },
    REPORTS,
  ),
};

/** The run ended without filing what it was asked for. */
export const Finished: Story = {
  args: standing({ state: "finished" }, REPORTS.slice(0, 1)),
};

export const Failed: Story = {
  args: standing(
    { state: "failed", reason: "the model provider refused the request" },
    REPORTS.slice(0, 1),
  ),
};

/** The hub refused the hand-off, so nothing started. */
export const Refused: Story = {
  args: {
    ...standing({
      state: "failed",
      reason: "a writer is already at work on Constraints",
    }),
    refused: true,
  },
};

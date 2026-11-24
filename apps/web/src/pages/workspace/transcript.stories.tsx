import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PromptQuestion } from "@corbits-builder/schemas/conversation";
import { fn } from "storybook/test";
import { RoomThread, type TranscriptTurn } from "./transcript.tsx";
import { ACTIVITY_SHOWN } from "../../config.ts";
import workUnit from "./work-unit-step.stories.tsx";

const BRIEF = { id: "problem_brief", title: "Problem brief" };

const opening: readonly TranscriptTurn[] = [
  {
    role: "person",
    text: "I run a small bakery and we lose cake orders taken by phone.",
    at: 1,
  },
  {
    role: "assistant",
    text: "That's worth fixing. I drafted the **Problem brief** from what you said. What should a good Saturday look like once this works?",
    at: 2,
  },
  {
    role: "person",
    text: "Every order in one list, and nobody calls back to ask.",
    at: 3,
  },
];

const asked: PromptQuestion["asked"] = {
  questions: [
    {
      id: "5d0c1b8e-2a47-4f3e-8b19-6e7d2c4a9f10",
      header: "Audience",
      question: "Who uses it first?",
      options: [
        { label: "The owner (Recommended)", description: "" },
        { label: "Counter staff", description: "" },
      ],
      multiple: false,
      custom: true,
    },
  ],
};

const meta = {
  title: "Screens/Workspace/Conversation",
  component: RoomThread,
  args: {
    turns: opening,
    documents: [BRIEF],
    onOpenDocument: fn(),
    standing: () => workUnit.args,
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div
        style={{ height: "100vh", display: "flex", flexDirection: "column" }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RoomThread>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { turns: [] } };

/** A document named in the conversation opens it in the reading pane. */
export const Conversation: Story = {};

export const Thinking: Story = {
  args: {
    turns: [
      ...opening,
      { role: "person", text: "Can you start on the plan?", at: 4 },
    ],
    thinking: true,
  },
};

const lookUp = (id: string) => ({
  kind: "tool-trace" as const,
  toolCallId: id,
  name: "discover",
  status: "output-available" as const,
  input: {},
});

const handOff = {
  kind: "tool-trace" as const,
  toolCallId: "call-writer",
  name: "execute",
  status: "output-available" as const,
  input: {
    plugin: "writer",
    action: "write",
    input: { kind: "constraints", instruction: "Write the limits." },
  },
};

/**
 * The coordinator at work with a writer started: its own steps, the writer's row, the writer's own
 * steps inside that row and the thinking line, each switched by its own control.
 */
export const AgentActivity: Story = {
  args: {
    turns: [
      ...opening,
      { role: "person", text: "Can you start on the plan?", at: 4 },
      {
        role: "assistant",
        text: "",
        at: 5,
        streaming: true,
        parts: [
          lookUp("call-look-1"),
          lookUp("call-look-2"),
          lookUp("call-look-3"),
          {
            kind: "tool-trace",
            toolCallId: "call-plan",
            name: "plan",
            status: "output-available",
            input: { operation: "set" },
          },
          handOff,
        ],
      },
    ],
    thinking: true,
    shows: ACTIVITY_SHOWN,
    standing: () => ({
      unitKey: "call-writer",
      status: {
        state: "working",
        since: new Date(Date.now() - 95_000).toISOString(),
      },
      label: "Writer · Writing the constraints",
      steps: [
        {
          kind: "tool-trace",
          toolCallId: "call-read",
          name: "Reading the problem brief",
          status: "output-available",
        },
        {
          kind: "tool-trace",
          toolCallId: "call-write",
          name: "Writing the constraints",
          status: "running",
        },
      ],
      preview: { kind: "waiting" },
      instruction: undefined,
      report: undefined,
      document: undefined,
      onOpenDocument: fn(),
      watch: undefined,
      stop: undefined,
      run: workUnit.args.run,
    }),
  },
};

/** A writer that has filed its document: the row's document card, instructions and report to switch. */
export const FinishedSpecialist: Story = {
  args: {
    turns: [
      ...opening,
      { role: "person", text: "Can you start on the plan?", at: 4 },
      {
        role: "assistant",
        text: "The constraints are ready for you to read.",
        at: 5,
        parts: [
          handOff,
          { kind: "text", text: "The constraints are ready for you to read." },
        ],
      },
    ],
    shows: ACTIVITY_SHOWN,
    standing: () => ({
      unitKey: "call-writer",
      status: {
        state: "ready",
        title: "Constraints",
        version: 1,
        kind: "constraints",
      },
      label: "Writer · Wrote the constraints",
      steps: [
        {
          kind: "tool-trace",
          toolCallId: "call-read",
          name: "Reading the problem brief",
          status: "output-available",
        },
        {
          kind: "tool-trace",
          toolCallId: "call-write",
          name: "Writing the constraints",
          status: "output-available",
        },
      ],
      preview: undefined,
      instruction:
        "Write the limits for the order list. Assume one counter tablet and no customer accounts.",
      report:
        "Filed the **constraints**: one counter tablet, no customer accounts.",
      document: {
        kind: "constraints",
        title: "Constraints",
        version: 1,
        summary:
          "- **One counter tablet** takes every order.\n- No customer accounts.",
        onOpen: fn(),
      },
      onOpenDocument: fn(),
      watch: undefined,
      stop: undefined,
      run: workUnit.args.run,
    }),
  },
};

export const Streaming: Story = {
  args: {
    turns: [
      ...opening,
      {
        role: "assistant",
        text: "Starting on the plan. First I'll list what",
        at: 4,
        streaming: true,
      },
    ],
  },
};

/** A decision stays in the conversation once made; one still open waits in the prompt box. */
export const ApprovalDecided: Story = {
  args: {
    approvals: [
      {
        approvalId: "approval-1",
        toolName: "run_shell",
        subject: "bun run build",
        outcome: { status: "approved", scope: "once" },
      },
    ],
  },
};

/** An answered question stays in the conversation; the open one waits in the prompt box. */
export const QuestionAnswered: Story = {
  args: {
    questions: [
      {
        at: 4,
        signalName: "signal:question-1",
        asked,
        status: "answered",
        answer: {
          answers: {
            "5d0c1b8e-2a47-4f3e-8b19-6e7d2c4a9f10": ["The owner (Recommended)"],
          },
        },
      },
    ],
  },
};

/** Specialists' mail from their own threads folds in between the turns. */
export const SpecialistUpdates: Story = {
  args: {
    updates: [
      {
        sender: "Writer",
        text: "Filed the problem brief, version 2.",
        at: 2.5,
      },
      { sender: "Designer", text: "Three concepts are ready.", at: 2.6 },
    ],
  },
};

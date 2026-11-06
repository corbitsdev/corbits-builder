import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AskQuestions } from "@corbits-builder/schemas/questions";
import { fn } from "storybook/test";
import { ASK_QUESTIONS } from "@corbits-builder/schemas/questions";
import { RoomThread, type TranscriptTurn } from "./transcript.tsx";

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

const ask: AskQuestions = {
  questions: [
    {
      id: "audience",
      prompt: "Who uses it first?",
      kind: "single",
      options: [
        { value: "owner", label: "The owner" },
        { value: "staff", label: "Counter staff" },
      ],
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
    onDecide: fn(),
    onRequestChanges: fn(),
    onAnswerQuestions: fn(() => Promise.resolve(true)),
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

export const AskingForApproval: Story = {
  args: {
    approvals: [
      {
        approvalId: "approval-1",
        toolName: "request_approval",
        document: { kind: BRIEF.id, title: BRIEF.title, version: 2 },
      },
    ],
  },
};

export const AskingQuestions: Story = {
  args: {
    turns: [
      ...opening,
      {
        role: "assistant",
        text: "",
        at: 4,
        parts: [
          {
            kind: "tool-trace",
            toolCallId: "call-questions",
            name: ASK_QUESTIONS,
            status: "output-available",
            input: ask,
          },
        ],
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

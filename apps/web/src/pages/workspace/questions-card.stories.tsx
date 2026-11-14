import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AskedQuestion } from "@corbits-builder/schemas/conversation";
import { fn } from "storybook/test";
import { QuestionsCard } from "./questions-card.tsx";

const ask: AskedQuestion = {
  questions: [
    {
      id: "audience",
      header: "Audience",
      question: "Who is it for?",
      options: [
        {
          label: "Bakery owners (Recommended)",
          description: "They take the orders and plan the day's baking.",
        },
        {
          label: "Counter staff",
          description: "They serve customers at the counter.",
        },
      ],
      multiple: false,
      custom: false,
    },
    {
      id: "first_version",
      header: "First version",
      question: "What must the first version do?",
      options: [
        { label: "Take orders", description: "" },
        { label: "List the day's orders", description: "" },
        { label: "Remind customers", description: "" },
      ],
      multiple: true,
      custom: true,
    },
    {
      id: "devices",
      header: "Devices",
      question: "Where will people order from?",
      options: [
        { label: "Phone", description: "" },
        { label: "Desktop browser", description: "" },
      ],
      multiple: true,
      custom: false,
    },
  ],
};

const meta = {
  title: "Screens/Workspace/QuestionsCard",
  component: QuestionsCard,
  args: {
    question: { at: 0, signalName: "call-1", asked: ask, status: "open" },
    disabled: false,
    onSend: fn(() => Promise.resolve(true)),
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 640 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QuestionsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One question at a time, the answered ones above it and the next below. */
export const Open: Story = {};

/** One question: no position, and the button sends. */
export const OneQuestion: Story = {
  args: {
    question: {
      at: 0,
      signalName: "call-1",
      asked: { questions: [ask.questions[1]!] },
      status: "open",
    },
  },
};

type PendingSend = { readonly fail: () => void };

/**
 * The send fails. As in the workspace, the card stays sending until the answer is accepted; "Fail
 * the send" refuses it, and the card reopens on the last question with the answers kept.
 */
export const NotSent: Story = {
  render: function NotSentCard(args) {
    const [pending, setPending] = useState<PendingSend>();
    const onSend = () =>
      new Promise<boolean>((resolve) => {
        setPending({
          fail: () => {
            setPending(undefined);
            resolve(false);
          },
        });
      });
    return (
      <>
        <QuestionsCard {...args} onSend={onSend} />
        {pending !== undefined && (
          <button type="button" onClick={pending.fail}>
            Fail the send
          </button>
        )}
      </>
    );
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Answered: Story = {
  args: {
    question: {
      at: 0,
      signalName: "call-1",
      asked: ask,
      status: "answered",
      answer: {
        answers: {
          audience: ["Bakery owners (Recommended)"],
          first_version: ["Take orders", "List the day's orders"],
          devices: ["Phone"],
        },
      },
    },
  },
};

/** Answered in the person's own words, so the card shows what they wrote instead of answers. */
export const AnsweredInChat: Story = {
  args: {
    question: {
      at: 0,
      signalName: "call-1",
      asked: ask,
      status: "answered",
      answer: { reply: "Actually, let's build a game." },
    },
  },
};

export const Closed: Story = {
  args: {
    question: { at: 0, signalName: "call-1", asked: ask, status: "closed" },
  },
};

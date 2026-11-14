import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AskedQuestion } from "@intx/types/runtime-core";
import { fn } from "storybook/test";
import { QuestionsCard } from "./questions-card.tsx";

const asked: AskedQuestion = {
  questions: [
    {
      id: "c2a9a3f4-1d7e-4c55-9a51-2f0a0b6c1e01",
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
      custom: true,
    },
    {
      id: "7b1e9d20-5f3c-4a8e-b6d2-93c4e5f6a702",
      header: "First version",
      question: "What must the first version do?",
      options: [
        {
          label: "Take orders",
          description: "Customers order online instead of by phone.",
        },
        { label: "List the day's orders", description: "" },
        { label: "Remind customers", description: "" },
      ],
      multiple: true,
      custom: true,
    },
    {
      id: "e4d8c1b2-9a7f-4e36-8c5d-1b2a3c4d5e03",
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
    id: "signal-1",
    asked,
    state: {
      kind: "open",
      disabled: false,
      onSend: fn(() => Promise.resolve(true)),
    },
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
  args: { asked: { questions: [asked.questions[1]!] } },
};

/** A question with nothing to pick: the person types their answer in a field of its own. */
export const TypedAnswer: Story = {
  args: {
    asked: {
      questions: [
        {
          id: "3f6a2c91-8e4b-4d07-a5c2-7b9e1d0f4a04",
          header: "Name",
          question: "What should the app be called?",
          options: [],
          multiple: false,
          custom: true,
        },
      ],
    },
  },
};

type PendingSend = { readonly fail: () => void };

/**
 * The send fails. As in the workspace, the card stays sending until the answer lands; "Fail the
 * send" refuses it, and the card reopens on the last question with the answers kept.
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
        <QuestionsCard
          {...args}
          state={{ kind: "open", disabled: false, onSend }}
        />
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
  args: {
    state: { kind: "open", disabled: true, onSend: fn() },
  },
};

export const Answered: Story = {
  args: {
    state: {
      kind: "answered",
      answer: {
        answers: {
          "c2a9a3f4-1d7e-4c55-9a51-2f0a0b6c1e01": [
            "Bakery owners (Recommended)",
          ],
          "7b1e9d20-5f3c-4a8e-b6d2-93c4e5f6a702": [
            "Take orders",
            "List the day's orders",
          ],
          "e4d8c1b2-9a7f-4e36-8c5d-1b2a3c4d5e03": ["Phone"],
        },
      },
    },
  },
};

/** The person wrote back instead of choosing; the card keeps what they wrote. */
export const AnsweredInOwnWords: Story = {
  args: {
    state: {
      kind: "answered",
      answer: { reply: "Actually, let's build a game." },
    },
  },
};

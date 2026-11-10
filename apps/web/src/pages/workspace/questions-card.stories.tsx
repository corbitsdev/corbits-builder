import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AskQuestions } from "@corbits-builder/schemas/questions";
import { fn } from "storybook/test";
import { wording } from "../../config.ts";
import { QuestionsCard } from "./questions-card.tsx";

const ask: AskQuestions = {
  questions: [
    {
      id: "audience",
      prompt: "Who is it for?",
      kind: "single",
      options: [
        { value: "owners", label: "Bakery owners" },
        { value: "staff", label: "Counter staff" },
      ],
      preselected: ["owners"],
    },
    {
      id: "first_version",
      prompt: "What must the first version do?",
      kind: "multi",
      options: [
        { value: "take", label: "Take orders" },
        { value: "list", label: "List the day's orders" },
        { value: "remind", label: "Remind customers" },
      ],
      allowOther: true,
    },
    {
      id: "devices",
      prompt: "Where will people order from?",
      kind: "multi",
      options: [
        { value: "phone", label: "Phone" },
        { value: "desktop", label: "Desktop browser" },
      ],
    },
  ],
};

const meta = {
  title: "Screens/Workspace/QuestionsCard",
  component: QuestionsCard,
  args: {
    id: "call-1",
    ask,
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
  args: { ask: { questions: [ask.questions[1]!] } },
};

type PendingSend = { readonly reply: string; readonly fail: () => void };

/**
 * The send fails. As in the workspace, the reply shows as sent at once, which settles the card;
 * "Fail the send" takes it back off, and the card reopens on the last question with the answers kept.
 */
export const NotSent: Story = {
  render: function NotSentCard(args) {
    const [pending, setPending] = useState<PendingSend>();
    const onSend = (reply: string) =>
      new Promise<boolean>((resolve) => {
        setPending({
          reply,
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
          state={
            pending === undefined
              ? { kind: "open", disabled: false, onSend }
              : { kind: "answered", reply: pending.reply }
          }
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
      reply: [
        wording.questions.answerLine("Who is it for?", ["Bakery owners"]),
        wording.questions.answerLine("What must the first version do?", [
          "Take orders",
          "List the day's orders",
        ]),
      ].join("\n"),
    },
  },
};

/** Answered in the person's own words, so the card shows no answers. */
export const AnsweredInChat: Story = {
  args: {
    state: { kind: "answered", reply: "Actually, let's build a game." },
  },
};

export const Replaced: Story = { args: { state: { kind: "replaced" } } };

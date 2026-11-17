import { QuestionOutcomes, type AnswerOutcome } from "./question-outcome.tsx";
import { wording } from "../../config.ts";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PromptQuestion } from "@corbits-builder/schemas/conversation";
import { fn } from "storybook/test";
import { QuestionsCard } from "./questions-card.tsx";

const ask: PromptQuestion["asked"] = {
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
    onAnswer: fn(() => Promise.resolve(true)),
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

/** A question with nothing to pick: the person types their answer in a field of its own. */
export const TypedAnswer: Story = {
  args: {
    question: {
      at: 0,
      signalName: "call-1",
      asked: {
        questions: [
          {
            id: "name",
            header: "Name",
            question: "What should the app be called?",
            options: [],
            multiple: false,
            custom: true,
          },
        ],
      },
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
    const [outcomes, setOutcomes] = useState<
      ReadonlyMap<string, AnswerOutcome>
    >(new Map());
    const [pending, setPending] = useState<PendingSend>();
    const onAnswer = () =>
      new Promise<boolean>((resolve) => {
        setPending({
          fail: () => {
            setPending(undefined);
            setOutcomes(
              new Map([
                [
                  args.question.signalName,
                  {
                    kind: "refused",
                    fault: wording.questions.answerFault.refused,
                  },
                ],
              ]),
            );
            resolve(false);
          },
        });
      });
    return (
      <>
        <QuestionOutcomes value={outcomes}>
          <QuestionsCard {...args} onAnswer={onAnswer} />
        </QuestionOutcomes>
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

/** One question closed: the title speaks of it alone. */
export const ClosedOneQuestion: Story = {
  args: {
    question: {
      at: 0,
      signalName: "call-1",
      asked: { questions: [ask.questions[0]!] },
      status: "closed",
    },
  },
};

/** Sent answers settle the card, as the room shows them, and focus moves onto what was answered. */
export const SettlesOnSend: Story = {
  render: function SettlingCard(args) {
    const [question, setQuestion] = useState<PromptQuestion>(args.question);
    return (
      <QuestionsCard
        {...args}
        question={question}
        onAnswer={(answer) => {
          if (!("output" in answer))
            setQuestion({
              at: question.at,
              signalName: question.signalName,
              asked: question.asked,
              status: "answered",
              answer,
            });
          return Promise.resolve(true);
        }}
      />
    );
  },
  args: {
    question: {
      at: 0,
      signalName: "call-settles",
      asked: { questions: [ask.questions[1]!] },
      status: "open",
    },
  },
};

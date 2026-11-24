import { QuestionOutcomes, type AnswerOutcome } from "./question-outcome.tsx";
import { wording } from "../../config.ts";
import { useState, type ReactNode } from "react";
import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import type { PromptQuestion } from "@corbits-builder/schemas/conversation";
import { expect, fn, userEvent, within } from "storybook/test";
import { composer } from "./prompt-box.fixtures.ts";
import { QuestionsCard } from "./questions-card.tsx";
import { RoomDockView } from "./room.view.tsx";

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

// An open question waits in the prompt box, which holds the words typed and draws Continue where
// Send stands; the box's own stories draw it partway through and picked.
function PromptBox({ children }: { children: ReactNode }) {
  const [text, setText] = useState("");
  return (
    <RoomDockView
      waiting={children}
      dock={{
        ...composer,
        placeholder: wording.questions.composerPlaceholder,
        text,
        onTextChange: setText,
        onSend: () => setText(""),
      }}
    />
  );
}

const inPromptBox: Decorator = (Story) => (
  <PromptBox>
    <Story />
  </PromptBox>
);

/** One question: no position, and Continue sends. */
export const OneQuestion: Story = {
  decorators: [inPromptBox],
  args: {
    question: {
      at: 0,
      signalName: "call-1",
      asked: { questions: [ask.questions[1]!] },
      status: "open",
    },
  },
};

/** Not now leaves the questions without choosing, saying so as the reply. */
export const NotNow: Story = {
  decorators: [inPromptBox],
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: wording.promptBox.waiting.notNow,
      }),
    );
    await expect(args.onAnswer).toHaveBeenCalledWith({
      reply: wording.promptBox.waiting.notNow,
    });
  },
};

/**
 * A question with nothing to pick: the person types their answer in the prompt box, the one place
 * to type, which asks for it.
 */
export const TypedAnswer: Story = {
  decorators: [inPromptBox],
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
  play: async ({ canvasElement }) => {
    const fields = within(canvasElement).getAllByRole("textbox");
    await expect(fields).toHaveLength(1);
    await expect(fields[0]).toHaveAttribute(
      "placeholder",
      wording.questions.typed,
    );
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
          <PromptBox>
            <QuestionsCard {...args} onAnswer={onAnswer} />
          </PromptBox>
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
  decorators: [inPromptBox],
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

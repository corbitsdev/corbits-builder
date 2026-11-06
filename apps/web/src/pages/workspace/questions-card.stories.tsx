import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AskQuestions } from "@corbits-builder/schemas/questions";
import { fn } from "storybook/test";
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
  ],
};

const meta = {
  title: "Screens/Workspace/QuestionsCard",
  component: QuestionsCard,
  args: {
    id: "call-1",
    ask,
    layout: "steps",
    state: {
      kind: "open",
      disabled: false,
      onSend: fn(() => Promise.resolve(true)),
    },
  },
  argTypes: { layout: { control: "inline-radio", options: ["steps", "all"] } },
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

/** One question at a time under step tabs ending in Submit. */
export const OneAtATime: Story = {};

export const AllAtOnce: Story = { args: { layout: "all" } };

export const Disabled: Story = {
  args: {
    state: { kind: "open", disabled: true, onSend: fn() },
  },
};

export const Answered: Story = {
  args: {
    state: {
      kind: "answered",
      response: {
        answers: [
          {
            id: "audience",
            question: "Who is it for?",
            answer: ["Bakery owners"],
          },
          {
            id: "first_version",
            question: "What must the first version do?",
            answer: ["Take orders", "List the day's orders"],
          },
        ],
      },
    },
  },
};

/** Answered in the person's own words, so the card shows no answers. */
export const AnsweredInChat: Story = {
  args: {
    state: {
      kind: "answered",
      response: { reply: "Actually, let's build a game." },
    },
  },
};

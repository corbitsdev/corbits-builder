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
  ],
};

const meta = {
  title: "Screens/Workspace/QuestionsCard",
  component: QuestionsCard,
  args: {
    id: "signal-1",
    asked,
    layout: "steps",
    state: {
      kind: "open",
      disabled: false,
      onSend: fn(() => Promise.resolve(true)),
      onCancel: fn(() => Promise.resolve(true)),
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

/** A pick on each question: the first moves the steps on, so the second shows a ticked row. */
export const OneAtATimeChosen: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("option", { name: "Bakery owners (Recommended)" }),
    );
    await userEvent.click(canvas.getByRole("option", { name: "Take orders" }));
  },
};

export const AllAtOnceChosen: Story = {
  args: { layout: "all" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("option", { name: "Counter staff" }),
    );
    // The kit's checkbox label holds its description too, so its name starts with the label.
    await userEvent.click(
      canvas.getByRole("checkbox", { name: /^Take orders/ }),
    );
  },
};

export const Disabled: Story = {
  args: {
    state: { kind: "open", disabled: true, onSend: fn(), onCancel: fn() },
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

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import writer from "@plugins/writer/package.json";
import approveDefinition from "@plugins/writer/src/approve/definition.ts";
import ApproveView from "@plugins/writer/src/approve/view.tsx";
import { wording } from "../../config.ts";
import { DocumentDecision } from "./document-decision.tsx";
import {
  composer,
  question,
  working,
  type ComposerDock,
} from "./prompt-box.fixtures.ts";
import { QuestionsCard } from "./questions-card.tsx";
import { RoomDockView } from "./room.view.tsx";
import { ScreenStory, storyScreen } from "./screen-story.tsx";

const pill = wording.promptBox.pill;

const approveDocuments = storyScreen(
  "@corbits-builder/writer approve",
  writer.builder.actions["approve"],
  { screen: approveDefinition, view: ApproveView, data: undefined },
);

/**
 * What waits on the person, each the very card the conversation shows it in: the box only frames
 * it.
 */
const waits = {
  question: () => (
    <QuestionsCard
      place="box"
      question={question}
      disabled={false}
      onAnswer={fn(() => Promise.resolve(true))}
    />
  ),
  documents: () => (
    <ScreenStory
      screen={approveDocuments}
      state="open"
      input={{ kinds: ["build_plan"] }}
      project={{}}
    />
  ),
  tool: () => (
    <DocumentDecision
      place="box"
      approval={{
        approvalId: "approval-1",
        toolName: "run_shell",
        subject: "bun run build",
      }}
      onYes={fn()}
      onAlways={fn()}
      onNo={fn()}
    />
  ),
} satisfies Record<string, () => ReactNode>;

type Args = {
  dock: ComposerDock;
  waiting?: keyof typeof waits;
  width?: number;
};

// Holds the words being typed, so a story can be typed into; the box sits at the foot of the
// space it is given, as it does under the page.
function Box({ dock, waiting, width = 560 }: Args) {
  const [text, setText] = useState(dock.text);
  return (
    <div
      style={{
        width: `min(${String(width)}px, 100%)`,
        margin: "0 auto",
        paddingTop: 64,
      }}
    >
      <RoomDockView
        waiting={waiting === undefined ? undefined : waits[waiting]()}
        dock={{
          ...dock,
          text,
          onTextChange: (next) => {
            setText(next);
            dock.onTextChange(next);
          },
          // A sent message leaves the box, as it does in the room.
          onSend: () => {
            dock.onSend();
            setText("");
          },
        }}
      />
    </div>
  );
}

const meta = {
  title: "Screens/Workspace/Prompt box",
  component: Box,
  args: { dock: composer },
} satisfies Meta<typeof Box>;

export default meta;
type Story = StoryObj<typeof meta>;

const typed = "Make the summary shorter and say who it is for";

/** Nothing typed, with the project's next step as the placeholder. */
export const Resting: Story = {
  args: {
    dock: {
      ...composer,
      placeholder: "The Brief is waiting for you. Anything to change?",
    },
  },
};

/** The box has the cursor, so its edge takes the action colour. */
export const Typing: Story = {
  args: { dock: { ...composer, text: typed } },
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole("textbox").focus();
  },
};

/** The message is on its way, so nothing more can be sent until it lands. */
export const Sending: Story = {
  args: { dock: { ...composer, text: typed, busy: true } },
};

/** Work runs: Stop stands where Send was, and the pill above says what is happening. */
export const Working: Story = { args: { dock: working } };

/** Typing while work runs brings Send back; Enter sends as usual. */
export const TypingWhileWorking: Story = {
  args: {
    dock: { ...working, text: "Also add the opening hours" },
  },
};

/** The coordinator's question, as the question card the conversation shows, framed by the box. */
export const Question: Story = {
  args: {
    dock: { ...composer, placeholder: wording.questions.composerPlaceholder },
    waiting: "question",
  },
};

/** The writer's screen for approving documents, with its own actions. */
export const ApproveDocuments: Story = { args: { waiting: "documents" } };

/** A tool asks before it runs, as the approval the conversation shows. */
export const ToolApproval: Story = { args: { waiting: "tool" } };

/** Sending would change a document work already started from; the person says so twice. */
export const ChangingEarlierDocument: Story = {
  args: {
    dock: {
      ...composer,
      text: "Change the audience to freelancers",
      caution: true,
    },
  },
};

/** Comments wait to be made: Send makes them, with or without words. */
export const CommentsWaiting: Story = {
  args: {
    dock: {
      ...composer,
      status: {
        state: "commentsWaiting",
        label: "3 comments on Problem brief",
        action: pill.sendComments,
        onAction: fn(),
      },
    },
  },
};

/** Long words wrap under the controls and the box grows, up to a point, then scrolls. */
export const LongText: Story = {
  args: {
    dock: {
      ...composer,
      text: "Make the summary shorter and say who it is for. Then add a section on how the counter staff take a phone order today, what they write down, where the paper goes, and what happens on a busy Saturday when two people call at once and the owner is at the oven. Keep the tone plain and the sentences short, and leave the delivery routes out of the first version entirely.",
    },
  },
};

/** At phone width the question keeps the box's width and the words wrap under it. */
export const Narrow: Story = {
  args: { waiting: "question", width: 360 },
};

export const Dark: Story = {
  args: { waiting: "question" },
  globals: { mode: "dark" },
};

export const DarkWorking: Story = {
  args: { dock: working },
  globals: { mode: "dark" },
};

/** Enter sends; Shift+Enter starts a new line instead. */
export const Keyboard: Story = {
  args: { dock: { ...composer, text: "First line" } },
  // Typing starts from words already in the box: user-event's typed characters reach the
  // textarea but not React's change handler, while real keys reach both.
  play: async ({ args, canvasElement }) => {
    const box = within(canvasElement).getByRole<HTMLTextAreaElement>("textbox");
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect(box).toHaveValue("First line\n");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(box).toHaveValue(""));
    await expect(args.dock.onSend).toHaveBeenCalledOnce();
  },
};

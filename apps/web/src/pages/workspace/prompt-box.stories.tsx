import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { wording } from "../../config.ts";
import { ScreenCard, StepCard } from "./box-cards.tsx";
import { DocumentDecision } from "./document-decision.tsx";
import {
  composer,
  question,
  working,
  type ComposerDock,
} from "./prompt-box.fixtures.ts";
import { QuestionsCard } from "./questions-card.tsx";
import { RoomDockView } from "./room.view.tsx";

/** What waits on the person, one card at a time: the box only frames it. */
const waits = {
  question: () => (
    <QuestionsCard
      question={question}
      disabled={false}
      onAnswer={fn(() => Promise.resolve(true))}
    />
  ),
  step: () => <StepCard title="Build the app" busy={false} onGoAhead={fn()} />,
  screen: () => <ScreenCard title="Approve documents" onOpen={fn()} />,
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
  otherTool: () => (
    <DocumentDecision
      place="box"
      approval={{
        approvalId: "approval-2",
        toolName: "write_file",
        subject: "src/routes/order.tsx",
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

const progressKey = `unsent:questions:${question.signalName}`;

const meta = {
  title: "Screens/Workspace/Prompt box",
  component: Box,
  args: { dock: composer },
  // The question card keeps its progress for the tab, so each story starts it afresh.
  beforeEach: () => sessionStorage.removeItem(progressKey),
} satisfies Meta<typeof Box>;

export default meta;
type Story = StoryObj<typeof meta>;

const typed = "Make the summary shorter and say who it is for";

/** Nothing typed: Send waits, muted, with the project's next step as the placeholder. */
export const Resting: Story = {
  args: {
    dock: {
      ...composer,
      placeholder: "The Brief is waiting for you. Anything to change?",
    },
  },
};

/** Words typed: Send turns the action blue. The box keeps its plain edge with the cursor in it. */
export const Typing: Story = {
  args: { dock: { ...composer, text: typed } },
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole("textbox").focus();
  },
};

/** The message is on its way: the box and its words stay, only Send waits, and the pill says so. */
export const Sending: Story = {
  args: {
    dock: {
      ...composer,
      text: typed,
      busy: true,
      status: { state: "working", label: "Sending your message" },
    },
  },
};

/** Work runs: Stop, in red, stands where Send was, and the pill above says what is happening. */
export const Working: Story = { args: { dock: working } };

/** Typing while work runs brings Send back; Enter sends as usual. */
export const TypingWhileWorking: Story = {
  args: {
    dock: { ...working, text: "Also add the opening hours" },
  },
};

// A story opens the question partway by seeding the progress the card keeps.
const questionAt =
  (step: number, chosen: readonly string[] = []) =>
  () => {
    sessionStorage.setItem(
      progressKey,
      JSON.stringify({
        step,
        answers: question.asked.questions.map((_, index) => ({
          chosen: index === step ? chosen : [],
          own: "",
        })),
      }),
    );
    return () => sessionStorage.removeItem(progressKey);
  };

const asking = {
  dock: { ...composer, placeholder: wording.questions.composerPlaceholder },
  waiting: "question",
} satisfies Args;

/**
 * The coordinator's question at rest: its options on a rail, the recommendation a tag, nothing
 * picked. Send waits, and the person's own words in the box answer instead.
 */
export const Question: Story = { args: asking };

/** Partway through, still nothing picked: Back stands beside where the question is among them. */
export const QuestionLater: Story = {
  args: asking,
  beforeEach: questionAt(1),
};

/**
 * An option picked: the rail turns the action blue, Continue stands where Send was, and the box
 * asks for details to go with it.
 */
export const QuestionPicked: Story = {
  args: asking,
  beforeEach: questionAt(1, ["Freelancers"]),
};

/**
 * The last question, pick-any, with both picked: each pick marked by its blue rail with no
 * checkboxes, and Continue where Send stands, as on every other question.
 */
export const QuestionPickAny: Story = {
  args: asking,
  beforeEach: questionAt(2, ["Phone", "Desktop browser"]),
};

/**
 * Details typed after a pick: Send, blue, carries them with the pick and moves on, so neither the
 * pick nor the answers before it are lost.
 */
export const QuestionPickedWithDetails: Story = {
  args: {
    ...asking,
    dock: { ...asking.dock, text: "Mostly one-person bakeries" },
  },
  beforeEach: questionAt(1, ["Freelancers"]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /send/i }));
    await waitFor(() =>
      expect(canvas.getByRole("heading")).toHaveTextContent(
        "Where will people order from?",
      ),
    );
    const saved = JSON.parse(sessionStorage.getItem(progressKey) ?? "{}");
    await expect(saved.answers[1]).toEqual({
      chosen: ["Freelancers"],
      own: "",
      details: "Mostly one-person bakeries",
    });
  },
};

/** The person types their own answer instead: Send comes back, blue. */
export const QuestionOwnAnswer: Story = {
  args: {
    ...asking,
    dock: { ...asking.dock, text: "Mostly home bakers selling at markets" },
  },
  beforeEach: questionAt(1),
};

/**
 * A step the person asked to be consulted on: the ask heads the box, and Yes, go ahead, green,
 * stands where Send is.
 */
export const StepGoAhead: Story = {
  args: {
    dock: {
      ...composer,
      placeholder: wording.promptBox.waiting.stepPlaceholder,
    },
    waiting: "step",
  },
};

/** Typing says what to do instead: Send, blue, takes the go-ahead's place. */
export const StepGoAheadTyping: Story = {
  args: {
    dock: { ...composer, text: "Wait until the menu is final" },
    waiting: "step",
  },
};

/**
 * A plugin's screen waits in the plugin space: the box names it, with Open to go to it. Its own
 * forward action reaches the box from the space.
 */
export const ScreenWaiting: Story = { args: { waiting: "screen" } };

/**
 * A tool asks before it runs: what would run in a block beneath the ask, Not yet beside it, and
 * Yes where Send stands.
 */
export const ToolApproval: Story = {
  args: {
    dock: { ...composer, placeholder: wording.approval.composerPlaceholder },
    waiting: "tool",
  },
};

/** Any other tool asks by its name and says plainly what it would touch; only a shell run is a command line. */
export const ToolApprovalOtherTool: Story = {
  args: {
    dock: { ...composer, placeholder: wording.approval.composerPlaceholder },
    waiting: "otherTool",
  },
};

/** Typing says what to do instead: Send, blue, takes Yes's place. */
export const ToolApprovalTyping: Story = {
  args: {
    dock: {
      ...composer,
      placeholder: wording.approval.composerPlaceholder,
      text: "Run the tests first",
    },
    waiting: "tool",
  },
};

/**
 * The words change a document work already started from: one grey line above them says what
 * sending restarts, and Send, blue, still sends at once.
 */
export const ChangingEarlierDocument: Story = {
  args: {
    dock: {
      ...composer,
      text: "Change the audience to freelancers",
      restarts: wording.earlierDocument.restarts(
        wording.earlierDocument.work["design"] ?? "",
      ),
    },
  },
};

const commenting = {
  ...composer,
  comments: 3,
  onSendComments: fn(),
} satisfies ComposerDock;

/** Comments wait in the row as a token; pressing it, or Send in the empty box, sends them as one message. */
export const CommentsWaiting: Story = {
  args: { dock: commenting },
  play: async ({ args, canvasElement }) => {
    const token = within(canvasElement).getByRole("button", {
      name: wording.promptBox.sendComments(3),
    });
    await userEvent.click(token);
    await expect(args.dock.onSendComments).toHaveBeenCalledOnce();
  },
};

/**
 * Words typed beside the comments: Send sends the words, and the token sends the comments alone,
 * leaving the words in the box.
 */
export const CommentsWithWords: Story = {
  args: { dock: { ...commenting, text: typed } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", {
        name: wording.promptBox.sendComments(3),
      }),
    );
    await expect(args.dock.onSendComments).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("textbox")).toHaveValue(typed);
  },
};

/**
 * A question is open, so a message now would answer it: the token stays, still reachable from the
 * keyboard, but sends nothing, and a line under the card says what to do first.
 */
export const CommentsWaitOnQuestion: Story = {
  args: {
    ...asking,
    dock: {
      ...commenting,
      placeholder: wording.questions.composerPlaceholder,
      commentsBlocked: wording.promptBox.commentsAfterQuestion,
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const token = canvas.getByRole("button", {
      name: wording.promptBox.sendComments(3),
    });
    await expect(token).toHaveAttribute("aria-disabled", "true");
    await expect(token).not.toHaveAttribute("disabled");
    await expect(token).toHaveAttribute(
      "title",
      wording.promptBox.commentsAfterQuestion,
    );
    token.focus();
    await expect(token).toHaveFocus();
    await userEvent.click(token);
    await expect(args.dock.onSendComments).not.toHaveBeenCalled();
    await expect(
      canvasElement.querySelector('[data-slot="comments-blocked"]'),
    ).toHaveTextContent(wording.promptBox.commentsAfterQuestion);
  },
};

/** Long words wrap in their own column beside the controls; the box grows, up to a point, then scrolls. */
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
  args: { ...asking, width: 360 },
};

export const Dark: Story = {
  args: asking,
  globals: { mode: "dark" },
};

export const DarkWorking: Story = {
  args: { dock: working },
  globals: { mode: "dark" },
};

export const DarkSending: Story = {
  ...Sending,
  globals: { mode: "dark" },
};

export const DarkQuestionPicked: Story = {
  ...QuestionPicked,
  globals: { mode: "dark" },
};

export const DarkStepGoAhead: Story = {
  ...StepGoAhead,
  globals: { mode: "dark" },
};

export const DarkScreenWaiting: Story = {
  ...ScreenWaiting,
  globals: { mode: "dark" },
};

export const DarkToolApproval: Story = {
  ...ToolApproval,
  globals: { mode: "dark" },
};

export const DarkCommentsWaiting: Story = {
  ...CommentsWaiting,
  globals: { mode: "dark" },
};

export const DarkCommentsWaitOnQuestion: Story = {
  ...CommentsWaitOnQuestion,
  globals: { mode: "dark" },
};

export const DarkChangingEarlierDocument: Story = {
  ...ChangingEarlierDocument,
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

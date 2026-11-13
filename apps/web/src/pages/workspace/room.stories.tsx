import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef, useState } from "react";
import { fn } from "storybook/test";
import { wording } from "../../config.ts";
import type { ArtifactPaneProps } from "./artifact-pane.tsx";
import documentPane, {
  AppAndManual as appAndManual,
  Concepts as conceptTabs,
  Loading as loadingDocument,
  ReadError as failedDocument,
} from "./artifact-pane.stories.tsx";
import nextStep, { YourTurn as yourTurn } from "./next-step.stories.tsx";
import { NextStepLineView } from "./next-step.view.tsx";
import { LIVE_TAB } from "./tab-follow.ts";
import {
  RoomView,
  type RoomComposer,
  type RoomViewProps,
} from "./room.view.tsx";
import thread, {
  AskingForApproval as askingForApproval,
  AskingQuestions as askingQuestions,
  Thinking as coordinatorThinking,
} from "./transcript.stories.tsx";

// Holds what the room asks its host to keep: the words being typed, whether the project view is
// open, and the document it reads.
function Room(args: RoomViewProps) {
  const { dock, documentPane: pane } = args;
  const [text, setText] = useState(dock.kind === "composer" ? dock.text : "");
  const [projectOpen, setProjectOpen] = useState(args.layout.projectOpen);
  const [selectedId, setSelectedId] = useState(pane.selectedId);
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <RoomView
        {...args}
        layout={{
          ...args.layout,
          projectOpen,
          onProjectOpenChange: setProjectOpen,
        }}
        dock={
          dock.kind === "composer"
            ? { ...dock, text, onTextChange: setText }
            : dock
        }
        documentPane={{
          ...pane,
          selectedId,
          state: selectedId === null ? undefined : pane.state,
          onSelect: setSelectedId,
        }}
      />
    </div>
  );
}

const composer: RoomComposer & { kind: "composer" } = {
  kind: "composer",
  text: "",
  onTextChange: fn(),
  onSend: fn(),
  placeholder: wording.composer.reply,
  inputRef: createRef(),
  working: false,
  busy: false,
  disabled: false,
  needsProvider: false,
  onEnableAi: fn(),
  attachments: {
    files: [],
    accept: "text/plain,image/png",
    fault: null,
    onAdd: fn(),
    onRemove: fn(),
  },
  sendFault: null,
  caution: null,
  onSendAnyway: fn(),
  onCancelCaution: fn(),
  suggestedReplies: [],
  onReply: fn(),
  sendLabel: null,
};

// One of the pane's own stories as the room takes it: what the pane shows, and its parts.
function paneOf(story: Partial<ArtifactPaneProps> = {}) {
  const pane = { ...documentPane.args, ...story };
  return { documentPane: pane, paneParts: pane };
}

const layout: RoomViewProps["layout"] = {
  projectReady: false,
  projectOpen: false,
  onProjectOpenChange: fn(),
  pageOpen: false,
};

// The room once the first documents are filed: the conversation still fills the room, and the
// project control opens them over it.
const withDocuments = {
  layout: { ...layout, projectReady: true },
  ...paneOf(),
} satisfies Partial<RoomViewProps>;

const meta = {
  title: "Screens/Workspace/Room",
  component: RoomView,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Bakery orders",
    layout,
    conversation: {
      thread: thread.args,
      empty: null,
    },
    dock: composer,
    plan: [],
    onDeclineStep: async () => {},
    onGoAheadStep: async () => {},
    onAskFirstStep: async () => {},
    ...paneOf(),
    paneRef: createRef(),
    nextStep: <NextStepLineView {...nextStep.args} />,
    page: null,
  },
  render: (args) => <Room {...args} />,
} satisfies Meta<typeof RoomView>;

export default meta;
type Story = StoryObj<typeof meta>;

const conversation = meta.args.conversation;

/** A project just started: nothing said and nothing filed, so the conversation is the whole room. */
export const NewProject: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, turns: [] },
      empty: "new",
    },
    nextStep: null,
  },
};

/** Talking with the coordinator before anything is filed. */
export const Conversation: Story = {};

export const CoordinatorThinking: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, ...coordinatorThinking.args },
    },
    dock: { ...composer, working: true },
  },
};

/** The coordinator asks for a yes on a document, which opens from the ask. */
export const ApprovalWaiting: Story = {
  args: {
    ...withDocuments,
    conversation: {
      ...conversation,
      thread: { ...thread.args, ...askingForApproval.args },
    },
    dock: {
      ...composer,
      placeholder: wording.approval.composerPlaceholder,
    },
    nextStep: <NextStepLineView {...nextStep.args} {...yourTurn.args} />,
  },
};

export const QuestionsOpen: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, ...askingQuestions.args },
    },
    dock: {
      ...composer,
      placeholder: wording.questions.composerPlaceholder,
    },
  },
};

/** The coordinator's last message offered answers; each is sent as it is. */
export const SuggestedReplies: Story = {
  args: {
    dock: {
      ...composer,
      suggestedReplies: ["The owner", "Counter staff"],
    },
  },
};

/** A file waits in the composer, and another was too big to take. */
export const AttachmentAndFault: Story = {
  args: {
    dock: {
      ...composer,
      text: "Here is last Saturday's order sheet.",
      attachments: {
        ...composer.attachments,
        files: [
          {
            id: "orders",
            name: "saturday-orders.csv",
            mediaType: "text/plain",
            size: 18_400,
          },
        ],
        fault: wording.attach.tooLarge("oven-manual.pdf", 10_000_000),
      },
    },
  },
};

export const SendFailed: Story = {
  args: {
    dock: {
      ...composer,
      text: "Can you start on the plan?",
      sendFault: "That message was not sent.",
    },
  },
};

/** The message changes a document a specialist already builds from, so it waits on a second yes. */
export const EarlierDocumentCaution: Story = {
  args: {
    ...withDocuments,
    dock: {
      ...composer,
      text: "Change the problem brief: we also take orders by email.",
      caution: "Designer",
    },
  },
};

/** No model provider is connected, so the box offers Enable AI in place of sending. */
export const NoProvider: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, turns: [] },
      empty: "new",
    },
    dock: { ...composer, needsProvider: true },
    nextStep: null,
  },
};

/** The project has no model to run on, which only Settings can settle. */
export const ModelNeeded: Story = {
  args: {
    dock: {
      kind: "modelNeeded",
      message: "Choose a model profile for this project.",
      onOpenSettings: fn(),
      onRetry: fn(),
    },
  },
};

/** The coordinator is starting; the person does not start it by typing. */
export const Starting: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, turns: [] },
    },
    dock: { kind: "starting" },
    nextStep: null,
  },
};

export const StartFailed: Story = {
  args: {
    conversation: {
      ...conversation,
      thread: { ...thread.args, turns: [] },
    },
    dock: {
      kind: "startFailed",
      message: wording.message.coordinatorNotStarted,
      onRetry: fn(),
    },
    nextStep: null,
  },
};

/** An archived project is read-only until it is restored. */
export const Archived: Story = {
  args: {
    ...withDocuments,
    ...paneOf(),
    dock: {
      kind: "archived",
      restoring: false,
      fault: null,
      onRestore: fn(),
    },
    nextStep: null,
  },
};

export const ArchivedRestoring: Story = {
  args: {
    ...withDocuments,
    ...paneOf(),
    dock: {
      kind: "archived",
      restoring: true,
      fault: null,
      onRestore: fn(),
    },
    nextStep: null,
  },
};

/** Documents are filed; the conversation fills the room and the project control opens them. */
export const WithDocument: Story = { args: withDocuments };

/** The project view open over the room, the prompt box still at its foot. */
export const ProjectOpen: Story = {
  args: {
    ...withDocuments,
    layout: { ...withDocuments.layout, projectOpen: true },
  },
};

export const DocumentLoading: Story = {
  args: {
    ...withDocuments,
    ...paneOf(loadingDocument.args),
  },
};

export const DocumentFailed: Story = {
  args: {
    ...withDocuments,
    ...paneOf(failedDocument.args),
  },
};

/** The app is being built: it runs in the open project view, beside the plan it is built from and its manual. */
export const AppBuilt: Story = {
  args: {
    ...ProjectOpen.args,
    ...paneOf({ ...appAndManual.args, openTab: { value: LIVE_TAB } }),
  },
};

/** The designers' concepts are filed, a tab each. */
export const ChoosingADesign: Story = {
  args: {
    ...withDocuments,
    ...paneOf(conceptTabs.args),
  },
};

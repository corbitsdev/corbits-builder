import { describe, expect, test } from "bun:test";
import { wording } from "../../../config.ts";
import { roomDock, type DockRoom } from "./room-dock.ts";
import { statusRooms } from "./sample-projects.testing.ts";

const none = () => {};

const ready: DockRoom = {
  archived: false,
  restore: { restoring: false, fault: null, onRestore: none },
  modelNeeded: null,
  providerMissing: false,
  startFault: null,
  onOpenSettings: none,
  onRetryStart: none,
  phase: { unbound: false, between: false, busy: false, composerWaits: false },
  composer: {
    box: {
      text: "",
      onTextChange: none,
      inputRef: { current: null },
      attachments: {
        files: [],
        accept: null,
        fault: null,
        onAdd: none,
        onRemove: none,
      },
      sendFault: null,
    },
    onSend: none,
    onEnableAi: none,
    suggestedReplies: [],
    onReply: none,
    approvalOpen: false,
    questionOpen: false,
    screenReply: undefined,
    nothingFiled: false,
    promptBox: {
      facts: statusRooms.quiet,
      working: false,
      restarts: null,
      status: null,
      onStop: none,
      decides: false,
    },
    comments: null,
  },
};

const unbound = {
  unbound: true,
  between: false,
  busy: false,
  composerWaits: true,
};

const drafted = {
  count: 2,
  blocked: null,
  sending: false,
  onSend: none,
  onShow: none,
  onRemove: none,
};

describe("what the foot of the room holds", () => {
  test("an archived project offers to restore it, whatever else stands", () => {
    expect(
      roomDock({
        ...ready,
        archived: true,
        modelNeeded: "Choose a model profile in Settings.",
        phase: unbound,
      }),
    ).toMatchObject({ kind: "archived", restoring: false, fault: null });
  });

  test("a coordinator with no model to run on sends the person to Settings, even one still bound", () => {
    expect(
      roomDock({
        ...ready,
        modelNeeded: "Choose a model profile in Settings.",
      }),
    ).toMatchObject({
      kind: "modelNeeded",
      message: "Choose a model profile in Settings.",
    });
  });

  test("a missing provider keeps the composer, which offers to connect one", () => {
    expect(
      roomDock({
        ...ready,
        modelNeeded: "Connect a model provider.",
        providerMissing: true,
        phase: unbound,
      }),
    ).toMatchObject({ kind: "composer", needsProvider: true, disabled: true });
  });

  test("an unbound room waits for its coordinator to start, and a refused start says why", () => {
    expect(roomDock({ ...ready, phase: unbound })).toEqual({
      kind: "starting",
    });
    expect(
      roomDock({
        ...ready,
        phase: unbound,
        startFault: "The coordinator for this project did not start.",
      }),
    ).toMatchObject({
      kind: "startFailed",
      message: "The coordinator for this project did not start.",
    });
  });

  test("a project between coordinators keeps its composer, waiting", () => {
    expect(
      roomDock({ ...ready, phase: { ...unbound, between: true } }),
    ).toMatchObject({ kind: "composer", disabled: true });
  });

  test("words or comments beside a screen asking to approve something ask for changes instead", () => {
    const deciding = (
      text: string,
      comments: DockRoom["composer"]["comments"],
    ) =>
      roomDock({
        ...ready,
        composer: {
          ...ready.composer,
          box: { ...ready.composer.box, text },
          promptBox: { ...ready.composer.promptBox, decides: true },
          comments,
        },
      });
    const makeChanges = wording.promptBox.waiting.makeChanges;
    expect(deciding("Make the header blue", null)).toMatchObject({
      sendLabel: makeChanges,
    });
    expect(deciding("  ", drafted)).toMatchObject({ sendLabel: makeChanges });
    expect(deciding("  ", null)).toMatchObject({ sendLabel: null });
    expect(
      roomDock({
        ...ready,
        composer: {
          ...ready.composer,
          box: { ...ready.composer.box, text: "Make the header blue" },
        },
      }),
    ).toMatchObject({ sendLabel: null });
  });

  test("comment drafts stand in the composer's row only while there are some", () => {
    expect(
      roomDock({
        ...ready,
        composer: { ...ready.composer, comments: drafted },
      }),
    ).toMatchObject({ comments: 2, commentsBlocked: null });
    expect(roomDock(ready)).not.toHaveProperty("comments");
  });
});

import { describe, expect, test } from "bun:test";
import { wording } from "../../../config.ts";
import { statusRooms as rooms } from "./sample-projects.testing.ts";
import { emptyLiveRun, foldLiveRun, type LiveRun } from "../chat/live-run.ts";
import {
  lastSentAt,
  roomPhase,
  roomStatus,
  rules,
  type RoomPhaseFacts,
} from "./room-status.ts";

const text = wording.promptBox.status;

describe("what the status line says", () => {
  test("the rules are checked in this order", () => {
    expect(rules.map(({ name }) => name)).toEqual([
      "a message is on its way",
      "specialists are at work",
      "the coordinator is working",
      "work failed since the person last wrote",
      "a step of the plan failed",
      "a version the person has not opened",
      "the app is running",
      "the app did not start",
    ]);
  });

  test("a quiet project shows no line", () => {
    expect(roomStatus(rooms.quiet)).toBeNull();
  });

  test("a message on its way wins over the coordinator thinking", () => {
    expect(roomStatus(rooms.sending)).toEqual({
      state: "working",
      label: text.sending,
      action: null,
    });
  });

  test("the coordinator thinking, with no specialist at work", () => {
    expect(roomStatus(rooms.thinking)).toEqual({
      state: "working",
      label: text.thinking,
      action: null,
    });
  });

  test("a specialist's work is said over the coordinator's thinking", () => {
    expect(roomStatus(rooms.writing)).toEqual({
      state: "working",
      label: "Writing the problem brief",
      action: null,
    });
  });

  test("several specialists: the first, and how many more", () => {
    expect(roomStatus(rooms.writingAndDesigning)?.label).toBe(
      "Writing the problem brief and 1 more",
    );
  });

  test("the newest stopped work since the person wrote offers Try again, neutral, over a new version", () => {
    expect(roomStatus(rooms.buildFailed)).toEqual({
      state: "ready",
      label: "Building the app stopped",
      action: {
        label: text.tryAgain,
        kind: "tryAgain",
        message: text.tryAgainMessage,
      },
    });
  });

  test("a failure the person wrote after is not raised again", () => {
    expect(roomStatus(rooms.failedBeforeMessage)).toBeNull();
  });

  test("a stopped step of the plan, inside a group, offers Try again, neutral", () => {
    expect(roomStatus(rooms.stepFailed)).toMatchObject({
      state: "ready",
      label: "Build the app stopped",
      action: { kind: "tryAgain" },
    });
  });

  test("the newest version the person has not opened, with Open", () => {
    expect(roomStatus(rooms.newVersion)).toEqual({
      state: "ready",
      label: "Build plan version 3 is ready",
      action: { label: text.open, kind: "openDocument", id: "build_plan" },
    });
  });

  test("a version waiting to be approved has no line of its own", () => {
    expect(roomStatus(rooms.approving)).toBeNull();
  });

  test("a version is not ready while the box asks a question", () => {
    expect(roomStatus(rooms.answering)).toBeNull();
  });

  test("no line shows while the box asks something, whatever else is going on", () => {
    expect(roomStatus(rooms.appRunningAsking)).toBeNull();
    expect(roomStatus(rooms.writingAsking)).toBeNull();
  });

  test("a first version is ready without its number", () => {
    expect(roomStatus(rooms.firstVersion)?.label).toBe("Build plan is ready");
  });

  test("the running app, once everything is opened", () => {
    expect(roomStatus(rooms.appRunning)).toEqual({
      state: "running",
      label: text.appRunning,
      action: { label: text.open, kind: "openApp" },
    });
  });

  test("the open project hears nothing that only opens it", () => {
    expect(roomStatus(rooms.appRunningOpen)).toBeNull();
  });

  test("an app that did not start opens to say why", () => {
    expect(roomStatus(rooms.appFailed)).toEqual({
      state: "failed",
      label: text.appFailed,
      action: { label: text.open, kind: "openApp" },
    });
  });

  test("an app still starting says nothing on its own", () => {
    expect(roomStatus(rooms.appStarting)).toBeNull();
  });
});

describe("when the person last wrote", () => {
  const turns = [
    { role: "person" as const, text: "Make a weather app", at: 10 },
    { role: "assistant" as const, text: "On it.", at: 20 },
  ];

  test("their latest turn, until a later send of theirs has not landed yet", () => {
    expect(lastSentAt(null, turns)).toBe(10);
    expect(lastSentAt(30, turns)).toBe(30);
    expect(lastSentAt(5, turns)).toBe(10);
  });

  test("a send before any turn of theirs, or never", () => {
    expect(lastSentAt(30, [])).toBe(30);
    expect(lastSentAt(null, [])).toBeNull();
  });
});

describe("where the room stands with its coordinator", () => {
  const talked = [
    { role: "person" as const, text: "Make a weather app", at: 10 },
    { role: "assistant" as const, text: "Which cities?", at: 20 },
  ];
  const quiet: RoomPhaseFacts = {
    status: "active",
    bound: true,
    mirror: talked,
    lastTurnRole: "assistant",
    liveRun: emptyLiveRun,
    runId: "run-c",
    waits: [],
    openApprovals: new Set(),
    questionOpen: false,
    coordinator: undefined,
    sending: false,
    approvalBusy: false,
    failed: false,
    awaitingSince: null,
    startFault: null,
    modelNeeded: false,
    providerMissing: false,
  };
  // The person wrote at 30 and no reply has come.
  const unanswered: RoomPhaseFacts = {
    ...quiet,
    lastTurnRole: "person",
    awaitingSince: 30,
  };
  const heldOnApproval: Pick<RoomPhaseFacts, "waits" | "openApprovals"> = {
    waits: [{ runId: "run-c", tenantId: "tenant-1", approvalId: "appr-1" }],
    openApprovals: new Set(["appr-1"]),
  };
  const writing: LiveRun = [
    { type: "message.run.started" },
    { type: "inference.start" },
    {
      type: "inference.text.delta",
      data: { partial: { text: "Checking the forecast API", toolCalls: [] } },
    },
  ].reduce((run, event) => foldLiveRun(run, event, null).run, emptyLiveRun);

  test("a quiet room neither thinks nor keeps the composer waiting", () => {
    expect(roomPhase(quiet)).toMatchObject({
      thinking: false,
      streaming: false,
      unbound: false,
      composerWaits: false,
      composerDisabled: false,
    });
  });

  test("a message with no reply yet keeps the thinking mark", () => {
    expect(roomPhase(unanswered)).toMatchObject({
      awaiting: true,
      thinking: true,
    });
  });

  test("a coordinator held on its own approval is not thinking, though the hub has it at work", () => {
    const phase = roomPhase({
      ...unanswered,
      ...heldOnApproval,
      coordinator: { since: "2026-11-20T10:00:00Z" },
    });
    expect(phase).toMatchObject({
      parked: true,
      held: true,
      working: true,
      awaiting: false,
      thinking: false,
    });
  });

  test("a reply being written streams until the coordinator parks on its approval", () => {
    expect(roomPhase({ ...quiet, liveRun: writing }).streaming).toBe(true);
    expect(
      roomPhase({ ...quiet, ...heldOnApproval, liveRun: writing }).streaming,
    ).toBe(false);
  });

  test("an open question holds the coordinator before the decisions are read", () => {
    expect(
      roomPhase({ ...unanswered, waits: undefined, questionOpen: true }),
    ).toMatchObject({ parked: true, held: true, thinking: false });
  });

  test("the hub's read of the coordinator at work counts only for a run begun after the stream saw one end", () => {
    const ended = {
      ...emptyLiveRun,
      endedAt: Date.parse("2026-11-20T10:00:00Z"),
    };
    const since = (at: string) =>
      roomPhase({ ...quiet, liveRun: ended, coordinator: { since: at } });
    expect(since("2026-11-20T10:05:00Z")).toMatchObject({
      working: true,
      thinking: true,
    });
    expect(since("2026-11-20T09:55:00Z")).toMatchObject({
      working: false,
      thinking: false,
    });
  });

  test("a project between coordinators reads as at work and keeps the composer waiting", () => {
    expect(roomPhase({ ...quiet, bound: false })).toMatchObject({
      unbound: true,
      between: true,
      thinking: true,
      awaitingBind: true,
      composerWaits: true,
    });
  });

  test("a new project waits for its first coordinator without the thinking mark", () => {
    expect(roomPhase({ ...quiet, bound: false, mirror: [] })).toMatchObject({
      between: false,
      thinking: false,
      awaitingBind: true,
      composerWaits: true,
    });
  });

  test("a refused start, or no model to run on, stops waiting on the coordinator", () => {
    for (const refused of [
      { startFault: "The coordinator for this project did not start." },
      { modelNeeded: true },
    ])
      expect(
        roomPhase({ ...unanswered, bound: false, ...refused }),
      ).toMatchObject({
        between: false,
        awaitingBind: false,
        awaiting: false,
        thinking: false,
      });
  });

  test("an archived project neither thinks over an unanswered message nor waits to bind", () => {
    expect(
      roomPhase({
        ...unanswered,
        status: "archived",
        bound: false,
        mirror: [],
        runId: null,
      }),
    ).toMatchObject({ awaiting: false, thinking: false, awaitingBind: false });
  });

  test("a coordinator that stopped before it replied drops the thinking mark", () => {
    expect(roomPhase({ ...unanswered, failed: true })).toMatchObject({
      awaiting: true,
      thinking: false,
    });
  });

  test("a decision on its way keeps the composer waiting without the thinking mark", () => {
    expect(roomPhase({ ...quiet, approvalBusy: true })).toMatchObject({
      busy: true,
      composerWaits: true,
      thinking: false,
    });
  });

  test("no model provider disables the composer without it waiting", () => {
    expect(roomPhase({ ...quiet, providerMissing: true })).toMatchObject({
      composerWaits: false,
      composerDisabled: true,
    });
  });
});

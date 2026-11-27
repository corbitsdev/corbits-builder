import { describe, expect, test } from "bun:test";
import { waitingRooms as rooms } from "./sample-projects.testing.ts";
import {
  boxCard,
  sendWarning,
  spaceScreens,
  waitingOn,
  type Waiting,
} from "./waiting.ts";

const keys = (waiting: readonly Waiting[]) => waiting.map(({ key }) => key);

describe("what waits on the person", () => {
  test("nothing waits in a quiet project", () => {
    const waiting = waitingOn(rooms.quiet);
    expect(waiting).toEqual([]);
    expect(boxCard(waiting)).toBeNull();
    expect(spaceScreens(waiting)).toEqual([]);
    expect(sendWarning(waiting)).toBeNull();
  });

  test("the coordinator's question waits, in the box", () => {
    const waiting = waitingOn(rooms.asking);
    expect(waiting).toEqual([
      { kind: "question", key: "question:orders", signalName: "orders" },
    ]);
    expect(boxCard(waiting)?.key).toBe("question:orders");
  });

  test("approvals wait earliest raised first, one with no time last", () => {
    expect(keys(waitingOn(rooms.approving))).toEqual([
      "approval:run-build",
      "approval:install-zod",
      "approval:unknown-time",
    ]);
  });

  test("a step waits for its go-ahead, inside a group too, and the next step behind it does not", () => {
    expect(waitingOn(rooms.consulting)).toEqual([
      {
        kind: "step",
        key: "step:plan",
        stepId: "plan",
        title: "Write the build plan",
      },
    ]);
  });

  test("a step given the go-ahead, not yet reached, or never asked about waits on no one", () => {
    expect(waitingOn(rooms.goneAhead)).toEqual([]);
  });

  test("a question drawn by a plugin's screen waits in the space, before a plugin's own screen", () => {
    const waiting = waitingOn(rooms.screens);
    expect(keys(waiting)).toEqual(["screen:fonts", "screen:tester notes"]);
    expect(spaceScreens(waiting).map((screen) => screen.from)).toEqual([
      "question",
      "plugin",
    ]);
    expect(spaceScreens(waiting)[0]).toMatchObject({
      signalName: "fonts",
      title: "Pick the fonts",
    });
    // The box lists the first screen too, with its way to open it.
    expect(boxCard(waiting)?.key).toBe("screen:fonts");
  });

  test("a plugin's own screen waits with no question open", () => {
    expect(spaceScreens(waitingOn(rooms.pluginScreen))).toEqual([
      {
        kind: "screen",
        key: "screen:tester notes",
        from: "plugin",
        plugin: "tester",
        action: "notes",
        title: "Notes for the tester",
      },
    ]);
  });

  test("the send warning waits last, and never as the box's card", () => {
    const waiting = waitingOn(rooms.restarting);
    expect(keys(waiting)).toEqual(["warning"]);
    expect(boxCard(waiting)).toBeNull();
    expect(sendWarning(waiting)).toBe("Sending this restarts the design.");
  });

  test("everything at once: questions, approvals, steps, screens, then the warning", () => {
    const waiting = waitingOn(rooms.everything);
    expect(waiting.map(({ kind }) => kind)).toEqual([
      "question",
      "approval",
      "step",
      "screen",
      "warning",
    ]);
    expect(boxCard(waiting)?.kind).toBe("question");
    expect(keys(spaceScreens(waiting))).toEqual(["screen:tester notes"]);
  });
});

import { describe, expect, test } from "bun:test";
import { wording } from "../../config.ts";
import { statusRooms as rooms } from "./sample-projects.testing.ts";
import { roomStatus, rules } from "./room-status.ts";

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

  test("the newest failure since the person wrote asks to try again, over a new version", () => {
    expect(roomStatus(rooms.buildFailed)).toEqual({
      state: "failed",
      label: "Building the app did not finish",
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

  test("a failed step of the plan, inside a group, asks to try again", () => {
    expect(roomStatus(rooms.stepFailed)).toMatchObject({
      state: "failed",
      label: "Build the app did not finish",
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

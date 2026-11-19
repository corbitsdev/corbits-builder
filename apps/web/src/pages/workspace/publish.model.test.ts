import { expect, test } from "bun:test";
import { HAND_OFF_MS, publishState } from "./publish-state.ts";
import {
  hubOffset,
  hubTimes,
  pressAfterAnswer,
  pressHolds,
} from "./publish.model.ts";

const agreed = {
  target: "server",
  release: "2026-11-18T10:00:00.000Z",
};

test("a press goes on through the answer a screen took on its way", () => {
  expect(pressAfterAnswer("publish", { output: { go: true } }, null)).toBe(
    "publish",
  );
  expect(pressAfterAnswer("takeDown", { output: { agreed } }, agreed)).toBe(
    "takeDown",
  );
});

test("keeping the app ends the press to take it down", () => {
  expect(
    pressAfterAnswer("takeDown", { output: { agreed: null } }, null),
  ).toBeNull();
});

test("words of the person's own in place of an answer hold nothing", () => {
  expect(
    pressAfterAnswer(
      "publish",
      { reply: "Not yet, change the colours." },
      null,
    ),
  ).toBeNull();
});

test("an answer given with nothing pressed holds nothing", () => {
  expect(pressAfterAnswer(null, { output: { go: true } }, null)).toBeNull();
});

const at = (time: string) => Date.parse(`2026-11-17T${time}.000Z`);
const iso = (time: string) => `2026-11-17T${time}.000Z`;

test("the hub's clock is read from the Date of its answer, at the middle of its second", () => {
  // This page's clock runs half a minute ahead of the hub's.
  expect(
    hubOffset({
      date: "Tue, 17 Nov 2026 11:00:00 GMT",
      receivedAt: at("11:00:30"),
    }),
  ).toBe(-29_500);
  expect(hubOffset(null)).toBe(0);
  expect(hubOffset({ date: "not a date", receivedAt: at("11:00:00") })).toBe(0);
});

// Pressed Publish at 11:00:00 by the hub's clock, with a publish plan already on the plan.
const press = { at: at("11:00:00"), planned: true, kind: "publish" } as const;
const seen = {
  planned: true,
  turnEndedAt: null,
  runs: [],
  working: true,
  now: at("11:00:05"),
};

test("a press holds the tab until the coordinator takes it up", () => {
  expect(pressHolds(press, seen)).toBe(true);
  // A turn that ended, or a publishing run that started, before the press says nothing of it.
  expect(
    pressHolds(press, {
      ...seen,
      turnEndedAt: at("10:59:59"),
      runs: [{ startedAt: iso("10:59:00") }],
    }),
  ).toBe(true);
  for (const taken of [
    { turnEndedAt: at("11:00:04") },
    { runs: [{ startedAt: iso("11:00:03") }] },
  ])
    expect(pressHolds(press, { ...seen, ...taken })).toBe(false);
  // A first publish is taken up once a publish plan goes on the plan.
  expect(pressHolds({ ...press, planned: false }, seen)).toBe(false);
  expect(
    pressHolds({ ...press, planned: false }, { ...seen, planned: false }),
  ).toBe(true);
});

test("a press nothing takes up stops holding once the hand-off passed with nothing at work", () => {
  const passed = { ...seen, now: press.at + HAND_OFF_MS };
  expect(pressHolds(press, passed)).toBe(true);
  expect(pressHolds(press, { ...passed, working: false })).toBe(false);
  expect(
    pressHolds(press, {
      ...seen,
      working: false,
      now: press.at + HAND_OFF_MS - 1,
    }),
  ).toBe(true);
});

test("a run that ended a moment ago by the hub's clock is in the hand-off, though the page's clock runs ahead", () => {
  // This page's clock runs half a minute ahead of the hub's, so it reads 11:00:30 when the hub's
  // reads 11:00:00, and the publish run ended 5 s before that by the hub's.
  const { now } = hubTimes(-30_000, {
    now: at("11:00:30"),
    turnEndedAt: null,
  });
  const fact = "published:server";
  const plan = "publish-to-server";
  const publishing = publishState({
    savedApp: true,
    ends: [fact],
    checks: [],
    release: {
      target: "server",
      url: "http://203.0.113.7",
      version: "abc123",
      at: iso("10:59:00"),
    },
    holding: undefined,
    takeDown: undefined,
    takeDowns: [],
    runs: [
      {
        plugin: "server",
        action: "publish",
        status: "completed",
        startedAt: iso("10:58:00"),
        endedAt: iso("10:59:55"),
      },
    ],
    asking: false,
    plans: [plan],
    plan: [{ plan, state: "not_started" }],
    working: false,
    pressed: null,
    acted: null,
    ranUntil: at("10:59:55"),
    keep: undefined,
    now,
  });
  expect(publishing?.state).toEqual({ state: "publishing" });
});

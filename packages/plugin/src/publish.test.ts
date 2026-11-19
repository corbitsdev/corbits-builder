import { expect, test } from "bun:test";
import { recordedFor, takeDownAgreed, takeDownStands } from "./publish.ts";

const RELEASED = "2026-11-18T10:00:00.000Z";
const HELD = "2026-11-18T09:00:00.000Z";
const release = { target: "example", at: RELEASED };
const holding = { target: "example", since: HELD };

test("what a take-down covers is the release and the holding the target itself recorded", () => {
  expect(recordedFor("example", null, null)).toEqual({});
  expect(recordedFor("example", { ...release, target: "other" }, null)).toEqual(
    {},
  );
  expect(recordedFor("example", null, holding)).toEqual({ holding: HELD });
  expect(recordedFor("example", release, holding)).toEqual({
    release: RELEASED,
    holding: HELD,
  });
});

test("a go-ahead stands only for exactly what the target recorded when the person agreed", () => {
  const agreed = { target: "example", release: RELEASED, holding: HELD };
  expect(takeDownStands(agreed, "example", release, holding)).toBe(true);
  expect(
    takeDownStands(
      { target: "example", holding: HELD },
      "example",
      null,
      holding,
    ),
  ).toBe(true);
  // Nothing recorded is nothing to take down.
  expect(takeDownStands(agreed, "example", null, null)).toBe(false);
  // Another target's release is not this target's to take down.
  expect(
    takeDownStands(
      { target: "example", release: RELEASED },
      "example",
      { ...release, target: "other" },
      null,
    ),
  ).toBe(false);
  // A release or a holding recorded since the person agreed makes the answer stale.
  expect(
    takeDownStands(
      agreed,
      "example",
      { ...release, at: "2026-11-18T11:00:00.000Z" },
      holding,
    ),
  ).toBe(false);
  expect(
    takeDownStands(
      { target: "example", holding: HELD },
      "example",
      release,
      holding,
    ),
  ).toBe(false);
  expect(takeDownStands(agreed, "other", release, holding)).toBe(false);
});

test("an answer that is not a go-ahead fails closed", () => {
  for (const answer of [
    undefined,
    null,
    "yes",
    { target: "example", release: "yesterday" },
    { target: "example", release: RELEASED, extra: true },
  ])
    expect(takeDownStands(answer, "example", release, null)).toBe(false);
});

test("a take-down tool reads the go-ahead and what is recorded from the project's values, a malformed record counting as none", () => {
  const values = {
    "publish.take-down": { target: "example", release: RELEASED },
    "publish.release": {
      ...release,
      url: "https://example.com/",
      version: "v1",
    },
    "publish.holding": null,
  };
  expect(takeDownAgreed(values, "example")).toBe(true);
  expect(
    takeDownAgreed(
      { ...values, "publish.release": { target: "example" } },
      "example",
    ),
  ).toBe(false);
});

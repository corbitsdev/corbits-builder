import { expect, test } from "bun:test";
import takeDown from "./definition.ts";

const release = {
  target: "server",
  url: "http://203.0.113.7/",
  version: "abc123",
  at: "2026-11-18T10:00:00.000Z",
};
const holding = {
  target: "hoster",
  place: "Hoster",
  since: "2026-11-18T09:00:00.000Z",
  costs: "$6 a month",
};
const input = { plan: "publish-to-server" };

test("the screen shows the release and the holding as recorded", () => {
  expect(
    takeDown.prepare?.(input, undefined, {
      "publish.release": release,
      "publish.holding": holding,
    }),
  ).toEqual({
    plan: "publish-to-server",
    release: { target: "server", url: release.url, at: release.at },
    holding,
  });
});

test("with nothing published or held there is nothing to ask about", () => {
  expect(takeDown.validate?.(input, undefined, {})).toEqual([
    expect.objectContaining({ field: "plan" }),
  ]);
  expect(
    takeDown.validate?.(input, undefined, { "publish.holding": holding }),
  ).toEqual([]);
});

test("keeping the app clears an earlier go-ahead to take it down", () => {
  const writes = takeDown.writes?.["publish.take-down"];
  expect(writes?.({ agreed: null })).toBeNull();
});

test("agreeing to take the app down ends a go-ahead to publish it, and keeping it leaves one as it is", () => {
  const writes = takeDown.writes?.["publish.go-ahead"];
  expect(writes?.({ agreed: { target: "server", release: release.at } })).toBe(
    null,
  );
  expect(writes?.({ agreed: null })).toBeUndefined();
});

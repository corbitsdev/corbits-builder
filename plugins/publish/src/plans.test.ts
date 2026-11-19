import { expect, test } from "bun:test";
import type { ReadyPlanOffer } from "@corbits-builder/plugin";
import { replacesRelease, takenDown } from "./plans.ts";

const cloudflare: ReadyPlanOffer = {
  handle: "publish-to-cloudflare",
  about: "Cloudflare.",
  when: "When Cloudflare fits.",
  plugins: ["cloudflare", "publish"],
};

test("publishing replaces only a release a plugin of the chosen plan made", () => {
  expect(
    replacesRelease({ target: "cloudflare", updatable: true }, cloudflare),
  ).toBe(true);
  expect(
    replacesRelease({ target: "server", updatable: true }, cloudflare),
  ).toBe(false);
});

test("a release its place cannot update yet is replaced by a new address, not updated", () => {
  expect(
    replacesRelease({ target: "cloudflare", updatable: false }, cloudflare),
  ).toBe(false);
});

test("a first publish, or a plan not offered, replaces nothing", () => {
  expect(replacesRelease(null, cloudflare)).toBe(false);
  expect(
    replacesRelease({ target: "cloudflare", updatable: true }, undefined),
  ).toBe(false);
});

const server: ReadyPlanOffer = {
  handle: "publish-to-server",
  about: "Your own server.",
  when: "When the person rents a server.",
  plugins: ["server", "publish"],
  takeDown: { plugin: "server", action: "remove" },
};
const released = {
  target: "server",
  url: "http://203.0.113.7/",
  at: "2026-11-18T10:00:00.000Z",
};
const held = {
  target: "server",
  place: "Example Cloud",
  since: "2026-11-18T09:00:00.000Z",
  costs: "$6 a month",
};

test("a take-down covers the release the plan's own place made, for the time it went out", () => {
  expect(takenDown(server, released, null)).toEqual({
    agreed: { target: "server", release: released.at },
    url: released.url,
    held: undefined,
  });
  expect(takenDown(server, { ...released, target: "cloudflare" }, null)).toBe(
    null,
  );
});

test("the person agrees for both the release and the holding there, shown with what it costs", () => {
  expect(takenDown(server, released, held)).toEqual({
    agreed: { target: "server", release: released.at, holding: held.since },
    url: released.url,
    held: { place: "Example Cloud", costs: "$6 a month" },
  });
  expect(takenDown(server, null, held)?.agreed).toEqual({
    target: "server",
    holding: held.since,
  });
});

test("a plan that takes nothing down, or one not offered, removes nothing", () => {
  expect(takenDown({ ...server, takeDown: undefined }, released, held)).toBe(
    null,
  );
  expect(takenDown(undefined, released, held)).toBe(null);
});

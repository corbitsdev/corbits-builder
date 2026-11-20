import { expect, test } from "bun:test";
import { goAheadLapsed } from "./go-ahead.ts";

const AGREED_AT = "2026-11-18T10:00:00.000Z";
const given = { plan: "publish-to-digitalocean", at: AGREED_AT };
const released = (at: string) => ({
  target: "digitalocean",
  url: "http://203.0.113.7/",
  version: "abc123",
  at,
});

test("a go-ahead stands through attempts that publish nothing, whatever was published before it", () => {
  expect(goAheadLapsed(given, undefined, undefined)).toBeUndefined();
  expect(
    goAheadLapsed(
      given,
      "publish-to-digitalocean",
      released("2026-11-17T10:00:00.000Z"),
    ),
  ).toBeUndefined();
});

test("the publish it allowed going out uses it up", () => {
  expect(
    goAheadLapsed(given, undefined, released("2026-11-18T10:05:00.000Z")),
  ).toBeDefined();
});

test("choosing another plan since ends it", () => {
  expect(
    goAheadLapsed(given, "publish-to-cloudflare", undefined),
  ).toBeDefined();
});

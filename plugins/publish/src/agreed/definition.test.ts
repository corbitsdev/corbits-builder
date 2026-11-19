import { expect, test } from "bun:test";
import type { ProjectView } from "@corbits-builder/plugin";
import agreed from "./definition.ts";

const AGREED_AT = "2026-11-18T10:00:00.000Z";
const goAhead = { plan: "publish-to-digitalocean", at: AGREED_AT };
const release = (at: string) => ({
  target: "digitalocean",
  url: "http://203.0.113.7/",
  version: "abc123",
  at,
});

// The check reads only project values; the rest of the view is never reached.
const outcome = (values: Record<string, unknown>) =>
  agreed.run?.(
    {
      values: async (name: string) => values[name] ?? null,
    } as unknown as ProjectView,
    {},
  );

test("a go-ahead stands until the publish it allowed goes out, and there is none without one", async () => {
  expect(await outcome({})).toMatchObject({ pass: false });
  expect(await outcome({ "publish.go-ahead": goAhead })).toMatchObject({
    pass: true,
  });
  expect(
    await outcome({
      "publish.go-ahead": goAhead,
      "publish.release": release("2026-11-18T10:05:00.000Z"),
    }),
  ).toMatchObject({ pass: false });
});

test("choosing another plan since ends it", async () => {
  expect(
    await outcome({
      "publish.go-ahead": goAhead,
      "publish.plan": "publish-to-cloudflare",
    }),
  ).toMatchObject({ pass: false });
});

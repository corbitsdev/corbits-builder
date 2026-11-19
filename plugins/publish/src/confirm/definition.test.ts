import { expect, test } from "bun:test";
import confirm from "./definition.ts";

const release = {
  target: "cloudflare",
  url: "https://app.example.workers.dev/",
  version: "abc123",
  at: "2026-11-18T10:00:00.000Z",
};
const keep = {
  link: "https://dash.example.com/keep?token=test-only",
  until: "2026-11-18T11:00:00.000Z",
  place: "Cloudflare",
};
const prepared = (project: Record<string, unknown>) =>
  confirm.prepare?.({ plan: "publish-to-cloudflare" }, undefined, project)
    .release;

test("a release its place can update is updated by the next publish", () => {
  expect(prepared({ "publish.release": release })).toEqual({
    target: "cloudflare",
    url: release.url,
    updatable: true,
  });
});

test("a release its place cannot update is not updated while the way to keep it is recorded", () => {
  const unkept = { ...release, replaceable: false };
  expect(
    prepared({ "publish.release": unkept, "publish.keep": keep })?.updatable,
  ).toBe(false);
  // Once the person cleared the way to keep it, having kept it, the next publish updates it.
  expect(
    prepared({ "publish.release": unkept, "publish.keep": null })?.updatable,
  ).toBe(true);
});

test("nothing published is nothing to replace", () => {
  expect(prepared({ "publish.release": null })).toBeNull();
});

test("the go-ahead saves the plan it is for and when it was given", () => {
  const before = Date.now();
  const saved = confirm.writes?.["publish.go-ahead"]?.({
    go: true,
    plan: "publish-to-cloudflare",
  }) as { plan: string; at: string };
  expect(saved.plan).toBe("publish-to-cloudflare");
  expect(Date.parse(saved.at)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(saved.at)).toBeLessThanOrEqual(Date.now());
});

test("a go-ahead to publish ends any go-ahead to take the app down", () => {
  expect(
    confirm.writes?.["publish.take-down"]?.({
      go: true,
      plan: "publish-to-cloudflare",
    }),
  ).toBeNull();
});

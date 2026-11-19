import { expect, test } from "bun:test";
import account from "./definition.ts";

const release = {
  target: "cloudflare",
  url: "https://app.temporary.workers.dev/",
  version: "abc123",
  at: "2026-11-18T10:00:00.000Z",
};
const keep = {
  link: "https://dash.cloudflare.com/claim/test-only",
  until: "2026-11-18T11:00:00.000Z",
  place: "Cloudflare",
};
const later = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();
const onTemporary = (keepUntil: string) => ({
  "cloudflare.site": {
    account: "acc-temporary",
    script: "app",
    temporary: true,
    keepUntil,
  },
  "publish.release": release,
});
const agreed = { target: "cloudflare", release: release.at };
const prepared = (project: Record<string, unknown>) =>
  account.prepare?.({}, undefined, project);

test("to publish, the screen offers both accounts, and says where an app on a temporary account stands", () => {
  expect(prepared({})).toEqual({ mode: "publish", temporary: "none" });
  expect(prepared(onTemporary(later(40)))).toEqual({
    mode: "publish",
    temporary: "keepable",
  });
  expect(prepared(onTemporary(later(-10)))).toEqual({
    mode: "publish",
    temporary: "lapsed",
  });
});

test("once the person agreed to take the app down, the screen asks only for the key to its account", () => {
  expect(
    prepared({
      "cloudflare.site": {
        account: "acc-own",
        script: "app",
        temporary: false,
      },
      "publish.release": release,
      "publish.take-down": agreed,
    }),
  ).toEqual({ mode: "takeDown" });
});

test("taking down an app on a temporary account the person never said they kept says when Cloudflare removes it", () => {
  const ahead = later(40);
  expect(
    prepared({
      ...onTemporary(ahead),
      "publish.keep": keep,
      "publish.take-down": agreed,
    }),
  ).toEqual({ mode: "takeDown", unkept: { until: ahead, passed: false } });
  const gone = later(-10);
  expect(
    prepared({
      ...onTemporary(gone),
      "publish.keep": keep,
      "publish.take-down": agreed,
    }),
  ).toEqual({ mode: "takeDown", unkept: { until: gone, passed: true } });
  // Once they said they kept it, it is theirs, and Cloudflare removes nothing by itself.
  expect(
    prepared({ ...onTemporary(gone), "publish.take-down": agreed }),
  ).toEqual({ mode: "takeDown" });
});

test("a take-down agreed for another place, or for an earlier release, leaves the screen to publishing", () => {
  for (const asked of [
    { target: "digitalocean", release: release.at },
    { target: "cloudflare", release: "2026-11-17T10:00:00.000Z" },
    null,
  ])
    expect(
      prepared({ ...onTemporary(later(40)), "publish.take-down": asked }),
    ).toEqual({ mode: "publish", temporary: "keepable" });
});

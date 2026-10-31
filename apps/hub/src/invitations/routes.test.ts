import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "@intx/hub-api";
import { ProjectError } from "../projects/errors.ts";
import { invitationSessionGuard } from "./routes.ts";

type Identity = AppEnv["Variables"];
const now = new Date();
const identity: Identity = {
  user: {
    id: "recipient",
    email: "recipient@example.invalid",
    emailVerified: true,
    name: "Recipient",
    createdAt: now,
    updatedAt: now,
  },
  session: {
    id: "human-session",
    userId: "recipient",
    token: "unused-fixture-token",
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  },
};

function probe(current: Identity, device = false) {
  const app = new Hono<AppEnv>();
  let mutations = 0;
  let reads = 0;
  app.onError((error, c) => {
    if (error instanceof ProjectError)
      return c.json({ code: error.code }, error.status);
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("user", current.user);
    c.set("session", current.session);
    await next();
  });
  app.use(
    "*",
    invitationSessionGuard(async () => device),
  );
  app.get("/invitation", (c) => {
    reads++;
    return c.json({ invitation: "protected-metadata" });
  });
  app.post("/invitation", async (c) => {
    const body: unknown = await c.req.json();
    mutations++;
    return c.json({ accepted: true, body });
  });
  return {
    request: (method: string, contentType?: string, body?: string) =>
      app.request("/invitation", {
        method,
        ...(contentType === undefined
          ? {}
          : { headers: { "content-type": contentType } }),
        ...(body === undefined ? {} : { body }),
      }),
    counts: () => ({ reads, mutations }),
  };
}

test("invitation routes refuse absent, mismatched, or device sessions before metadata or mutations", async () => {
  for (const [current, device] of [
    [{ user: null, session: null }, false],
    [{ ...identity, user: null }, false],
    [{ ...identity, session: null }, false],
    [
      {
        ...identity,
        session: { ...identity.session!, userId: "different-user" },
      },
      false,
    ],
    [identity, true],
  ] satisfies [Identity, boolean][]) {
    const app = probe(current, device);
    for (const method of ["GET", "HEAD", "POST"]) {
      const response = await app.request(
        method,
        method === "POST" ? "application/json" : undefined,
        method === "POST" ? "{}" : undefined,
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain("protected-metadata");
    }
    expect(app.counts()).toEqual({ reads: 0, mutations: 0 });
  }
});

test("a matching human session can read without activating and submit an explicit JSON mutation", async () => {
  const app = probe(identity);
  const get = await app.request("GET");
  expect(get.status).toBe(200);
  expect(await get.json()).toEqual({ invitation: "protected-metadata" });
  const head = await app.request("HEAD");
  expect(head.status).toBe(200);
  expect(await head.text()).toBe("");
  expect(app.counts()).toEqual({ reads: 2, mutations: 0 });
  for (const contentType of [
    "application/json",
    "application/json; charset=utf-8",
  ]) {
    const post = await app.request(
      "POST",
      contentType,
      '{"confirmation":true}',
    );
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({
      accepted: true,
      body: { confirmation: true },
    });
    expect(post.headers.get("cache-control")).toBe("no-store");
  }
  expect(app.counts()).toEqual({ reads: 2, mutations: 2 });
});

test("invitation mutations reject simple form and text requests despite a valid session", async () => {
  const app = probe(identity);
  for (const contentType of [
    undefined,
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=example",
    "application/jsonp",
  ]) {
    const response = await app.request("POST", contentType, "{}");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "json_body_required" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(app.counts()).toEqual({ reads: 0, mutations: 0 });
});

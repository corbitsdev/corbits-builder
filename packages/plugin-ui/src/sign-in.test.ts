import { afterEach, beforeEach, expect, test } from "bun:test";
import { interchange } from "./interchange-stub.testing.ts";
import { followSignIn, savedSignIn } from "./sign-in.ts";

const stamp = { createdAt: "2026-01-01", updatedAt: "2026-01-01" };

let stub: ReturnType<typeof interchange>;
beforeEach(() => {
  stub = interchange();
});
afterEach(() => stub.restore());

const held = (fields: Record<string, unknown>) =>
  stub.credentials.push({
    id: `c-${String(stub.credentials.length)}`,
    tenantId: "p1",
    providerId: "ws-row",
    name: "plugin.hoster",
    status: "active",
    ...stamp,
    ...fields,
  });

test("a sign-in saved in the project names the account it connected, and says when the provider stopped taking it", async () => {
  held({
    type: "oauth_token",
    metadata: { oauthProvider: "plugin.hoster", account: "Acme team" },
  });
  expect(await savedSignIn("p1", "hoster")).toEqual({
    account: "Acme team",
    signedOut: false,
  });
  stub.credentials[0]!["status"] = "error";
  expect(await savedSignIn("p1", "hoster")).toEqual({
    account: "Acme team",
    signedOut: true,
  });
});

test("a pasted key, or a sign-in the workspace holds, is not the project's sign-in", async () => {
  held({ type: "api_key", metadata: null });
  expect(await savedSignIn("p1", "hoster")).toBeUndefined();
  stub.credentials.length = 0;
  held({ tenantId: "ws", type: "oauth_token", metadata: {} });
  expect(await savedSignIn("p1", "hoster")).toBeUndefined();
});

test("a sign-in is followed until the hub says it ended, and is late once its deadline passes while it is open", async () => {
  const signal = new AbortController().signal;
  const slept: number[] = [];
  const sleep = async (ms: number) => {
    slept.push(ms);
  };
  stub.signInStates.push(
    { status: "pending" },
    { status: "pending" },
    { status: "done" },
  );
  expect(
    await followSignIn("p1", "sign-in-1", {
      deadline: Number.POSITIVE_INFINITY,
      signal,
      sleep,
    }),
  ).toEqual({ status: "done" });
  expect(slept).toHaveLength(2);

  stub.signInStates.splice(0, stub.signInStates.length, { status: "pending" });
  expect(
    await followSignIn("p1", "sign-in-1", {
      deadline: 10,
      signal,
      now: () => 10,
      sleep,
    }),
  ).toEqual({ status: "late" });
});

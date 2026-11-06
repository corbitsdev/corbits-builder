import { afterAll, expect, mock, test } from "bun:test";
import { environmentManager } from "@tanstack/react-query";
import type { ModelLoginState } from "@corbits-builder/client";
import * as actualTransport from "../../api/transport.ts";
import { wording } from "../../config.ts";

const realTransport = { ...actualTransport };
let answers: ModelLoginState[] = [];

mock.module("../../api/transport.ts", () => ({
  ...realTransport,
  productClient: () => ({
    modelLogin: async () => answers.shift() ?? { status: "pending" },
  }),
}));
// The poll is a browser's: without a window, react-query schedules no refetch timers.
const wasServer = environmentManager.isServer();
environmentManager.setIsServer(() => false);
afterAll(() => {
  environmentManager.setIsServer(() => wasServer);
  mock.module("../../api/transport.ts", () => realTransport);
});

const { loginCredential } = await import("./providers.tsx");

test("a login that completes after a pending poll yields its credential", async () => {
  answers = [
    { status: "pending" },
    { status: "completed", credentialId: "cred_1" },
  ];

  expect(await loginCredential("t1", "login_1", Date.now() + 60_000)).toBe(
    "cred_1",
  );
});

test("a login the hub reports failed rejects with the hub's message", async () => {
  answers = [
    { status: "failed", message: "The provider refused the sign-in." },
  ];

  await expect(
    loginCredential("t1", "login_2", Date.now() + 60_000),
  ).rejects.toThrow("The provider refused the sign-in.");
});

test("a login still pending at its deadline rejects as timed out", async () => {
  answers = [];

  await expect(
    loginCredential("t1", "login_3", Date.now() + 1),
  ).rejects.toThrow(wording.providers.timedOut);
});

import { afterEach, expect, test } from "bun:test";
import { wording } from "../config.ts";
import { getHubSession } from "./auth.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(body: string) {
  globalThis.fetch = Object.assign(async () => new Response(body), {
    preconnect: realFetch.preconnect,
  });
}

test("only better-auth's null means signed out; an unreadable session is an error", async () => {
  answer("null");
  expect(await getHubSession()).toBeNull();
  answer("<html>proxy</html>");
  await expect(getHubSession()).rejects.toThrow(wording.auth.accountUnreadable);
  answer(JSON.stringify({ user: { id: "u1" } }));
  await expect(getHubSession()).rejects.toThrow(wording.auth.accountUnreadable);
});

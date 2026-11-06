import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { sessionAuth, sessionQuery } from "./session.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answers(...replies: (() => Response)[]) {
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      const reply = replies[Math.min(calls, replies.length - 1)];
      calls += 1;
      if (reply === undefined) throw new Error("no reply");
      return reply();
    },
    { preconnect: realFetch.preconnect },
  );
  return () => calls;
}

// The session as the interface reads it, once the check has settled.
function settledSession() {
  const observer = new QueryObserver(new QueryClient(), {
    ...sessionQuery,
    retryDelay: 0,
  });
  expect(sessionAuth(observer.getCurrentResult())).toBe("unknown");
  return new Promise<ReturnType<typeof observer.getCurrentResult>>(
    (resolve) => {
      const unsubscribe = observer.subscribe((read) => {
        if (read.status === "pending") return;
        unsubscribe();
        resolve(read);
      });
    },
  );
}

test("a first session check made while the hub is down signs in once it answers", async () => {
  const calls = answers(
    () => {
      throw new TypeError("connection refused");
    },
    () => new Response("bad gateway", { status: 502 }),
    () => Response.json({ user: { id: "u1", email: "a@example.test" } }),
  );
  const read = await settledSession();
  expect(calls()).toBe(3);
  expect(sessionAuth(read)).toBe("signed-in");
});

test("a session that will never read leads to signing in, not a stuck boot", async () => {
  const calls = answers(() => new Response("bad request", { status: 400 }));
  const read = await settledSession();
  expect(calls()).toBe(1);
  expect(sessionAuth(read)).toBe("signed-out");
});

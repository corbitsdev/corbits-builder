import { expect, test } from "bun:test";
import type { HttpMediatedCredential } from "@intx/types";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  CredentialRefused,
  mediatedHttpJson,
  workflowHttpJson,
  WorkflowHttpError,
} from "./http-json.ts";

const call = (
  fetch: HttpMediatedCredential["fetch"],
  signal = new AbortController().signal,
) =>
  mediatedHttpJson({
    credential: { kind: "http", fetch, dispose: () => undefined },
    path: "/api/tenants/t/projects/p/design-draft/previous",
    maxResponseBytes: 1024,
    signal,
  });

test("a hub refusal reaches the agent as the hub's code and why", async () => {
  const refusal = call(async () =>
    Response.json(
      {
        code: "design_draft_too_large",
        privateDetail: "must not reach the agent",
        hint: "The draft cannot be loaded: the design is 1953 KB.",
      },
      { status: 409 },
    ),
  );
  await expect(refusal).rejects.toMatchObject({
    message:
      "design_draft_too_large: The draft cannot be loaded: the design is 1953 KB.",
  });
  await expect(refusal).rejects.toMatchObject({ refused: true });
});

test("a refusal without a hint names its code, status and field issues", async () => {
  await expect(
    call(async () =>
      Response.json(
        {
          code: "invalid_artifact_write",
          issues: [{ path: "content", message: "must be a design bundle" }],
        },
        { status: 400 },
      ),
    ),
  ).rejects.toMatchObject({
    message:
      "invalid_artifact_write: the hub refused the call (HTTP 400); content must be a design bundle",
  });
});

test("a hub that failed or could not be reached is unavailable, not a refusal", async () => {
  const failed = call(async () =>
    Response.json({ error: "internal_error" }, { status: 503 }),
  );
  await expect(failed).rejects.toMatchObject({
    message: "workflow_http_unavailable:http_503",
  });
  await expect(failed).rejects.toMatchObject({ refused: false });
  const unreachable = call(async () => {
    throw new TypeError("Unable to connect");
  });
  await expect(unreachable).rejects.toMatchObject({
    message: "workflow_http_unavailable:unreachable",
  });
  await expect(unreachable).rejects.toBeInstanceOf(WorkflowHttpError);
});

// A DELETE through a credential the run holds, answered by response, and how each call was made.
function deleting(response: () => Response) {
  const seen: RequestInit[] = [];
  const answer = mediatedHttpJson({
    credential: {
      kind: "http",
      fetch: async (_path, init) => {
        seen.push(init ?? {});
        return response();
      },
      dispose: () => undefined,
    },
    path: "/v2/machines/7",
    method: "DELETE",
    maxResponseBytes: 1024,
    signal: new AbortController().signal,
  });
  return { answer, seen };
}

test("a call is made with the method it asks for", async () => {
  const { answer, seen } = deleting(() => Response.json({}));
  await answer;
  expect(seen).toMatchObject([{ method: "DELETE" }]);
});

test("a call never follows a redirect", async () => {
  const { answer, seen } = deleting(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://elsewhere.example/" },
      }),
  );
  await expect(answer).rejects.toMatchObject({ status: 302, refused: false });
  expect(seen).toMatchObject([{ redirect: "manual" }]);
});

test("an answer with no body is nothing", async () => {
  expect(
    await deleting(() => new Response(null, { status: 204 })).answer,
  ).toBeUndefined();
  expect(
    await deleting(() => new Response("", { status: 200 })).answer,
  ).toBeUndefined();
});

test("a provider's own words for a refusal are kept as one short printable line, apart from the message", async () => {
  const refusal = call(async () =>
    Response.json(
      {
        id: "forbidden",
        message: `Your account is locked.\u001b[31m\nContact support.${"!".repeat(400)}`,
      },
      { status: 403 },
    ),
  );
  await expect(refusal).rejects.toMatchObject({
    message: "hub_refused: the hub refused the call (HTTP 403)",
  });
  const error = (await refusal.catch((caught: unknown) => caught)) as {
    words: string;
  };
  expect(error.words).toStartWith("Your account is locked.");
  expect(error.words).toContain("Contact support.");
  const control = [...error.words].filter((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  expect(control).toEqual([]);
  expect(error.words.length).toBeLessThanOrEqual(300);
  await expect(
    call(async () => Response.json({ code: "x" }, { status: 400 })),
  ).rejects.toMatchObject({ words: undefined });
});

test("caller cancellation is preserved rather than reported as a hub outage", async () => {
  const canceled = new Error("caller canceled");
  const signal = AbortSignal.abort(canceled);
  await expect(
    call(async () => {
      throw canceled;
    }, signal),
  ).rejects.toBe(canceled);
});

// A provider's API through a credential the run holds, answering each call in turn from answers
// (the last one repeated), and each ask and wait in turn; a test never really sleeps.
function provider(answers: readonly (() => Response)[]) {
  const asked: string[] = [];
  // Each ask and each wait, in the order they came.
  const events: ("ask" | "wait")[] = [];
  const capabilities = {
    resolve: () => ({
      resolve: async () => ({
        kind: "http",
        fetch: async (path: string) => {
          asked.push(path);
          events.push("ask");
          return answers[Math.min(asked.length, answers.length) - 1]!();
        },
        dispose() {},
      }),
    }),
  } as unknown as RuntimeCapabilities;
  const call = (signedIn: boolean, signal = new AbortController().signal) =>
    workflowHttpJson({
      capabilities,
      handle: "hoster",
      path: "/v2/machines",
      body: { size: "small" },
      maxResponseBytes: 1024,
      signal,
      ...(signedIn
        ? {
            signedIn: {
              sleep: async () => {
                events.push("wait");
              },
            },
          }
        : {}),
    });
  return { call, asked, events };
}

const refused = () => Response.json({ id: "unauthorized" }, { status: 401 });

test("a signed-in call refused while its token is renewed is asked again after the waits, and goes through once the new token arrives", async () => {
  const api = provider([refused, refused, () => Response.json({ id: 7 })]);
  expect(await api.call(true)).toEqual({ id: 7 });
  expect(api.events).toEqual(["ask", "wait", "ask", "wait", "ask"]);
});

test("a signed-in call still refused after every wait fails as try_again", async () => {
  const api = provider([refused]);
  const failed = api.call(true);
  await expect(failed).rejects.toBeInstanceOf(CredentialRefused);
  await expect(failed).rejects.toMatchObject({ refusalCode: "try_again" });
  expect(api.events).toEqual([
    "ask",
    "wait",
    "ask",
    "wait",
    "ask",
    "wait",
    "ask",
  ]);
});

test("a call not made as signed in is refused at the first 401, as a refused pasted key is", async () => {
  const api = provider([refused]);
  await expect(api.call(false)).rejects.toMatchObject({ status: 401 });
  expect(api.asked).toHaveLength(1);
});

test("a signed-in call that failed at the provider or lost its connection is never asked again", async () => {
  const failing = provider([() => new Response("down", { status: 503 })]);
  await expect(failing.call(true)).rejects.toMatchObject({ refused: false });
  expect(failing.asked).toHaveLength(1);
  const reset = provider([
    () => {
      throw new TypeError("socket closed");
    },
  ]);
  await expect(reset.call(true)).rejects.toMatchObject({
    message: "workflow_http_unavailable:unreachable",
  });
  expect(reset.asked).toHaveLength(1);
});

test("a run cancelled while a signed-in call waits stops waiting", async () => {
  const controller = new AbortController();
  const cancelled = new Error("run cancelled");
  const api = provider([
    () => {
      controller.abort(cancelled);
      return refused();
    },
  ]);
  await expect(api.call(true, controller.signal)).rejects.toBe(cancelled);
  expect(api.asked).toHaveLength(1);
});

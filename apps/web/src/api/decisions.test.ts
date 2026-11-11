import { afterEach, expect, spyOn, test } from "bun:test";
import { openWorkspace } from "./auth.ts";
import { openDecisions } from "./decisions.ts";

const realFetch = globalThis.fetch;
const realWindow = globalThis.window;
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.defineProperty(globalThis, "window", {
    value: realWindow,
    configurable: true,
  });
});

const asked = {
  type: "SignalAwaited",
  body: {
    parkKind: "question",
    signalName: "question-1",
    at: "2026-11-10T10:00:00.000Z",
    question: {
      questions: [
        {
          id: "q-audience",
          header: "Audience",
          question: "Who is it for?",
          options: [{ label: "Small teams", description: "" }],
          multiple: false,
          custom: false,
        },
      ],
    },
  },
};

function hubWith(events: { type: string; body: Record<string, unknown> }[]) {
  const replies: Record<string, unknown> = {
    "/api/tenants/ws/projects?status=active": {
      projects: [{ projectId: "p1", tenantId: "pt", title: "Shop" }],
    },
    "/api/tenants/ws/projects/p1/conversation/events": {
      runId: "run-1",
      events: events.map((event, seq) => ({ seq, ...event })),
    },
    "/api/tenants/pt/approvals": { data: [] },
  };
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input);
      return Response.json(replies[url.pathname + url.search]);
    },
    { preconnect: realFetch.preconnect },
  );
}

test("an open question waits on the person only while its coordinator runs", async () => {
  Object.defineProperty(globalThis, "window", {
    value: { location: { origin: "http://hub" } },
    configurable: true,
  });
  // No browser storage here, so the workspace is held in memory; its warning is expected.
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  openWorkspace("ws");
  warn.mockRestore();
  hubWith([asked]);
  expect((await openDecisions()).map((wait) => wait.id)).toEqual([
    "question-1:question",
  ]);
  for (const end of ["RunFailed", "RunCancelled", "RunCompleted"]) {
    hubWith([asked, { type: end, body: {} }]);
    expect(await openDecisions()).toEqual([]);
  }
});

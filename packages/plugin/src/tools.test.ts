import { expect, test } from "bun:test";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import { BuilderUnavailable } from "./run-hub.ts";
import { fixedTools, type Outcome } from "./tools.ts";

// A plugin's fixed tools, each answering with what its deps make of the call.
const tools = fixedTools<{ answer: () => Promise<Outcome> }>({
  id: "@corbits-builder/example/tools",
  credentials: ["example"],
  tools: {
    example_run: {
      description: "Runs.",
      run: (deps) => deps.answer(),
    },
  },
  deps: () => ({ answer: current }),
});
let current: () => Promise<Outcome>;

async function call(answer: () => Promise<Outcome>) {
  current = answer;
  const [factory] = tools({ role: "example" });
  if (factory === undefined) throw new Error("no tools");
  return factory({ toolCwd: "/unused" } as never).run(
    { id: "call", name: "example_run", arguments: {} },
    new AbortController().signal,
  );
}

test("the tools declare the plugin's keys and the run's hub credential", () => {
  const [factory] = tools({ role: "example" });
  expect(factory?.credentials?.map(({ handle }) => handle)).toEqual([
    "example",
    HUB_CREDENTIAL_HANDLE,
  ]);
});

test("whatever a tool throws is builder_unavailable and nothing else, never a status, message or path", async () => {
  for (const thrown of [
    new BuilderUnavailable({
      cause: new Error("HTTP 401 /api/tenants/t/projects/p/run-values"),
    }),
    new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:8000"),
    new Error("server printed: root:x:0:0"),
  ])
    expect(
      await call(async () => {
        throw thrown;
      }),
    ).toEqual({
      callId: "call",
      content: '{"ok":false,"code":"builder_unavailable"}',
      isError: true,
    });
});

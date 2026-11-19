import { expect, test } from "bun:test";
import { defineTool } from "@intx/agent/authoring";

import { sourceStepToolFactories } from "./step-tools";

test("a source step's tool keeps which of its credentials are optional for the launch reconcile", () => {
  const factory = defineTool({
    id: "@example/publisher/tools",
    definitions: [{ name: "publish" }],
    credentials: [
      { handle: "publisher-api", optional: true },
      { handle: "publisher-cdn", scopes: ["write"] },
    ],
    factory: () => ({ definitions: [], run: async () => ({ callId: "", content: "" }) }),
  });
  expect(sourceStepToolFactories([factory])[0]?.declaredCredentials).toEqual([
    { handle: "publisher-api", optional: true },
    { handle: "publisher-cdn", scopes: ["write"] },
  ]);
});

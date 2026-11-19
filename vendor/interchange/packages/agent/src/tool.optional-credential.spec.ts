import { expect, test } from "bun:test";

import { defineTool } from "./tool";

test("a tool's credential declared optional stays optional on the defined factory", () => {
  const factory = defineTool({
    id: "@example/publisher/tools",
    definitions: [{ name: "publish" }],
    credentials: [
      { handle: "publisher-api", optional: true },
      { handle: "publisher-cdn" },
    ],
    factory: () => ({ definitions: [], run: async () => ({ callId: "", content: "" }) }),
  });
  expect(factory.credentials).toEqual([
    { handle: "publisher-api", optional: true },
    { handle: "publisher-cdn" },
  ]);
});

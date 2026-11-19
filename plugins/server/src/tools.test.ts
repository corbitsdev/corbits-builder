import { expect, test } from "bun:test";
import type { AgentTools } from "@corbits-builder/plugin/tools";
import removeTools from "./remove-tools.ts";
import tools from "./tools.ts";

// The tool names an agent is given, as each factory declares them to Interchange.
const names = (of: AgentTools) =>
  of({ role: "server" }).flatMap((factory) =>
    factory.definitions.map(({ name }) => name),
  );

test("publishing and taking down are each one agent's, and the remove agent cannot publish", () => {
  expect(names(tools)).toEqual(["server_release", "server_status"]);
  expect(names(removeTools)).toEqual(["server_unpublish", "server_status"]);
});

import { expect, test } from "bun:test";
import type { AgentTools } from "@corbits-builder/plugin/tools";
import createTools from "./create-tools.ts";
import removeTools from "./remove-tools.ts";
import tools from "./tools.ts";

// The tool names an agent is given, as each factory declares them to Interchange.
const names = (of: AgentTools) =>
  of({ role: "digitalocean" }).flatMap((factory) =>
    factory.definitions.map(({ name }) => name),
  );

test("making, publishing and removing are each one agent's, and none holds two of them", () => {
  expect(names(createTools)).toEqual(["digitalocean_create"]);
  expect(names(tools)).toEqual(["digitalocean_release", "digitalocean_status"]);
  expect(names(removeTools)).toEqual([
    "digitalocean_destroy",
    "digitalocean_server_status",
  ]);
});

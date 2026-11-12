import { expect, test } from "bun:test";
import { composeCoordinatorPrompt } from "./prompt.ts";

// The prompt leaves the order of work to each tool's refusals, so it names no document
// order and never makes approving imported documents a step before a change.
test("the prompt carries no staged document path", () => {
  const prompt = composeCoordinatorPrompt();
  expect(prompt).not.toMatch(/constraints.*approaches.*product requirements/s);
  expect(prompt).not.toContain("baseline");
});

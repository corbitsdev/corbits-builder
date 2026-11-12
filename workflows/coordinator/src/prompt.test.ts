import { expect, test } from "bun:test";
import { composeCoordinatorPrompt } from "./prompt.ts";

test("composeCoordinatorPrompt includes slide deck presentation instructions and omits experimental approval round triage from static core", () => {
  const prompt = composeCoordinatorPrompt("classic");
  expect(prompt).toContain("## Sharing and presenting for an audience");
  expect(prompt).toContain("deploy_presenter");
  expect(prompt).not.toContain("approval_package");
  expect(prompt).not.toContain("reviewer feedback (external");
});

// The dynamic prompt leaves the order of work to each tool's refusals, so it names no document
// order and never makes approving imported documents a step before a change.
test("the dynamic prompt carries no staged document path", () => {
  const prompt = composeCoordinatorPrompt("dynamic");
  expect(prompt).not.toMatch(/constraints.*approaches.*product requirements/s);
  expect(prompt).not.toContain("baseline");
});

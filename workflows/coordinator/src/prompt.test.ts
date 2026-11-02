import { expect, test } from "bun:test";
import { composeCoordinatorPrompt } from "./prompt.ts";

test("composeCoordinatorPrompt includes slide deck presentation instructions and omits experimental approval round triage from static core", () => {
  const prompt = composeCoordinatorPrompt();
  expect(prompt).toContain("## Sharing and presenting for an audience");
  expect(prompt).toContain("deploy_presenter");
  expect(prompt).not.toContain("approval_package");
  expect(prompt).not.toContain("reviewer feedback (external");
});

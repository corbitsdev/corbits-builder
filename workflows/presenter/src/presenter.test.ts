import { expect, test } from "bun:test";
import { createPresenterAgent } from "./agent.ts";
import { presenterPrompt } from "./prompt.ts";
import { presentingSkills } from "./skills.ts";
import { createPresenterWorkflow } from "./workflow.ts";

test("createPresenterAgent requires explicit provider and model and sets presenter tags", () => {
  expect(() =>
    createPresenterAgent({
      id: "presenter",
      inference: { provider: "", model: "claude-sonnet-5-5" },
      tools: [],
      capabilities: [],
    }),
  ).toThrow("Presenter requires an explicit provider and model");

  const agent = createPresenterAgent({
    id: "presenter",
    inference: { provider: "anthropic", model: "claude-sonnet-5-5" },
    tools: [],
    capabilities: [],
  });
  expect(agent.id).toBe("presenter");
  expect(agent.systemPrompt).toBe(presenterPrompt);
  expect(agent.tags).toEqual({ "presenter.version": "0.1.0-rc.3" });
  expect(presenterPrompt).toContain("write_deck");
  expect(presenterPrompt).toContain("check_deck");
  expect(presenterPrompt).toContain("file_package");
  expect(presenterPrompt).toContain("never ask the person directly");
});

test("createPresenterWorkflow creates a bounded single-trigger mail workflow", () => {
  const agent = createPresenterAgent({
    id: "presenter",
    inference: { provider: "anthropic", model: "claude-sonnet-5-5" },
    tools: [],
    capabilities: [],
  });
  const workflow = createPresenterWorkflow({
    id: "corbits-builder-presenter",
    address: "presenter",
    agent,
    inference: { literal: { maxTokens: 32768 } },
  });
  expect(workflow.id).toBe("corbits-builder-presenter");
  expect(workflow.triggers).toEqual([{ type: "mail", to: "presenter" }]);
  expect(workflow.steps.present).toMatchObject({
    triggers: 1,
    drainBehavior: "wait",
  });
});

test("presentingSkills bundles the presenting skill and per-persona guidance", () => {
  const skills = presentingSkills();
  const skill = skills["presenting"]?.["SKILL.md"];
  expect(skill).toBeDefined();
  expect(skill).toContain("Lead with the decision needed");
  expect(skill).toContain("One idea per slide");
  expect(skill).toContain("Reuse the project's design tokens");
  expect(skill).toContain("End with the explicit ask");
  for (const persona of ["ceo", "cto", "investor", "client", "end_user"]) {
    expect(skill).toContain(persona);
  }
});

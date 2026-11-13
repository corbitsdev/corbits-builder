import { expect, test } from "bun:test";
import { createPresenterAgent } from "./agent.ts";
import {
  AUDIENCE_PERSONAS,
  findAudiencePersona,
  formatPersonaGuidance,
  presenterAssignmentMessage,
} from "./personas.ts";
import { presenterPrompt } from "./prompt.ts";
import { presentingSkills } from "./skills.ts";
import { createPresenterWorkflow } from "./workflow.ts";

test("createPresenterAgent requires explicit provider and model and tags the presenter role", () => {
  expect(() =>
    createPresenterAgent({
      id: "presenter",
      role: "presenter",
      inference: { provider: "", model: "claude-sonnet-5-5" },
      tools: [],
      capabilities: [],
    }),
  ).toThrow("Presenter requires an explicit provider and model");

  const agent = createPresenterAgent({
    id: "presenter",
    role: "presenter",
    inference: { provider: "anthropic", model: "claude-sonnet-5-5" },
    tools: [],
    capabilities: [],
  });
  expect(agent.id).toBe("presenter");
  expect(agent.systemPrompt).toBe(presenterPrompt);
  expect(agent.tags).toEqual({ role: "presenter" });
  expect(presenterPrompt).toContain("write_deck");
  expect(presenterPrompt).toContain("check_deck");
  expect(presenterPrompt).toContain("file_package");
  expect(presenterPrompt).toContain("never ask the person directly");
});

test("createPresenterWorkflow creates a bounded single-trigger mail workflow", () => {
  const agent = createPresenterAgent({
    id: "presenter",
    role: "presenter",
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

test("AUDIENCE_PERSONAS defines ceo, cto, investor, client and end_user with their default documents", () => {
  expect(AUDIENCE_PERSONAS.map((persona) => persona.id)).toEqual([
    "ceo",
    "cto",
    "investor",
    "client",
    "end_user",
  ]);
  expect(findAudiencePersona("ceo")?.defaultDocuments).toEqual([
    "problem_brief",
    "approaches",
    "build_plan",
  ]);
  expect(findAudiencePersona("cto")?.defaultDocuments).toEqual([
    "problem_brief",
    "constraints",
    "approaches",
    "build_plan",
  ]);
  expect(findAudiencePersona("investor")?.defaultDocuments).toEqual([
    "problem_brief",
    "approaches",
    "product_requirements",
  ]);
  expect(findAudiencePersona("client")?.defaultDocuments).toEqual([
    "problem_brief",
    "product_requirements",
    "build_plan",
  ]);
  expect(findAudiencePersona("end_user")?.defaultDocuments).toEqual([
    "problem_brief",
    "product_requirements",
  ]);

  const guidance = formatPersonaGuidance(findAudiencePersona("ceo")!);
  expect(guidance).toContain("Audience persona: CEO (ceo)");
  expect(guidance).toContain(
    "business outcome, strategic fit, risks, resource ask",
  );
  const message = presenterAssignmentMessage({
    audience: "ceo",
    decisionNeeded: "Approve Q3 staffing and budget",
    tone: "Executive and direct",
    length: "6 slides",
    instruction:
      "Prepare an executive deck for our CEO covering the brief, chosen approach and build plan.",
    documents: [
      {
        artifactId: "art-brief",
        kind: "problem_brief",
        title: "Problem Brief",
        version: 2,
        sha256: "a".repeat(64),
        content: "# Problem Brief\nCut onboarding time in half.",
      },
    ],
  });
  expect(message).toContain("Approve Q3 staffing and budget");
  expect(message).toContain("Cut onboarding time in half.");
  expect(message).toContain('"personaId": "ceo"');
});

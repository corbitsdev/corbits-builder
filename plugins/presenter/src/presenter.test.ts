import { expect, test } from "bun:test";
import {
  AUDIENCE_PERSONAS,
  findAudiencePersona,
  formatPersonaGuidance,
  presenterAssignmentMessage,
} from "./personas.ts";

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
        path: ".inputs/problem_brief.md",
      },
    ],
  });
  expect(message).toContain("Approve Q3 staffing and budget");
  expect(message).toContain(".inputs/problem_brief.md");
  expect(message).toContain('"personaId": "ceo"');
});

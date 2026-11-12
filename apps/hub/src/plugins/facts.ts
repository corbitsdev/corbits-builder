import type { Fact } from "@corbits-builder/plugin";
import { isDocumentKind } from "@corbits-builder/schemas/artifact";
import type { Preferences } from "@corbits-builder/schemas/preferences";
import { agentDecidesApprovals } from "../config/preferences.ts";

// The documents a plugin may name in a plain fact. Any other document's kind is named through a
// template on a field the plugin takes, such as "filed:{kind}", and holds once it is filed.
export const DOCUMENT_KINDS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "build_plan",
] as const;

// Every fact a plugin may name plainly. A design option is filed but never approved: the person
// approves a design by choosing one.
export const FACTS: ReadonlySet<Fact> = new Set([
  ...[...DOCUMENT_KINDS, "design_option"].map((kind) => `filed:${kind}`),
  ...DOCUMENT_KINDS.map((kind) => `approved:${kind}`),
  "design_chosen",
  "app_exists",
]);

type Filed = { kind: string; version: number; approvedVersion?: number };

/** What is true of a project, from its filed artifacts and how the person chose to work. */
export function projectFacts(project: {
  artifacts: readonly Filed[];
  preferences: Preferences;
}): ReadonlySet<Fact> {
  const facts = new Set<Fact>();
  const agentDecides = agentDecidesApprovals(project.preferences);
  for (const { kind, version, approvedVersion } of project.artifacts) {
    const approved = approvedVersion === version;
    if (kind === "app") facts.add("app_exists");
    if (kind === "design" && approved) facts.add("design_chosen");
    if (kind === "design_option") facts.add("filed:design_option");
    if (!isDocumentKind(kind)) continue;
    facts.add(`filed:${kind}`);
    if (approved || agentDecides) facts.add(`approved:${kind}`);
  }
  return facts;
}

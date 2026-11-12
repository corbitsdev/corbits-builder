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

// The latest record of a check, with the facts it returns for its input.
type Checked = {
  result: "pass" | "fail" | "skipped";
  current: boolean;
  returns: readonly Fact[];
};

/**
 * What is true of a project, from its filed artifacts, how the person chose to work and its checks.
 * A fact a check returns holds while that check's latest record is a pass or the person's skip and
 * everything it read is still what the project has saved.
 */
export function projectFacts(project: {
  artifacts: readonly Filed[];
  preferences: Preferences;
  checks: readonly Checked[];
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
  for (const { result, current, returns } of project.checks)
    if (current && result !== "fail")
      for (const fact of returns) facts.add(fact);
  return facts;
}

/**
 * The go-ahead facts the person's own answers made true: each document they approved at its current
 * version and the design chosen. An approval left to Builder is not among them, so a route step
 * whose approval is required still waits for the person. A design Builder chose for a single
 * concept is recorded as chosen, so it counts.
 */
export function personFacts(artifacts: readonly Filed[]): ReadonlySet<Fact> {
  const facts = new Set<Fact>();
  for (const { kind, version, approvedVersion } of artifacts) {
    if (approvedVersion !== version) continue;
    if (kind === "design") facts.add("design_chosen");
    if (isDocumentKind(kind)) facts.add(`approved:${kind}`);
  }
  return facts;
}

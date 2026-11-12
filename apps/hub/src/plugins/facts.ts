import type { Fact } from "@corbits-builder/plugin";
import type { Preferences } from "@corbits-builder/schemas/preferences";
import { agentDecidesApprovals } from "../config/preferences.ts";

// The documents a person approves, each filed and approved under its own kind.
export const DOCUMENT_KINDS = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "build_plan",
] as const;

// Every fact Builder can work out. A design option is filed but never approved: the person
// approves a design by choosing one.
export const FACTS: ReadonlySet<Fact> = new Set([
  ...[...DOCUMENT_KINDS, "design_option"].map((kind) => `filed:${kind}`),
  ...DOCUMENT_KINDS.map((kind) => `approved:${kind}`),
  "design_chosen",
  "app_exists",
]);

// A fact that names one of a plugin's input fields, such as "filed:{kind}".
const TEMPLATE = /^(filed|approved):\{(\w+)\}$/;

/** The input field a templated fact names, or undefined for a plain fact. */
export const templateField = (fact: Fact) => TEMPLATE.exec(fact)?.[2];

/** Each fact with its input field replaced by the value passed there, one fact for each listed value. */
export function resolveFacts(facts: readonly Fact[], input: unknown): Fact[] {
  const fields = new Map(
    typeof input === "object" && input !== null ? Object.entries(input) : [],
  );
  return facts.flatMap((fact) => {
    const match = TEMPLATE.exec(fact);
    if (!match) return [fact];
    const value = fields.get(match[2]!);
    return (Array.isArray(value) ? value : [value]).map(
      (item) => `${match[1]}:${String(item)}`,
    );
  });
}

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
    if (!FACTS.has(`filed:${kind}`)) continue;
    facts.add(`filed:${kind}`);
    if (FACTS.has(`approved:${kind}`) && (approved || agentDecides))
      facts.add(`approved:${kind}`);
  }
  return facts;
}

/**
 * The one check of what a plugin requires: for each alternative, the facts it still lacks. An
 * empty list means nothing is required or one alternative holds.
 */
export function unmet(
  requires: readonly (readonly Fact[])[],
  facts: ReadonlySet<Fact>,
): Fact[][] {
  const missing = requires.map((alternative) =>
    alternative.filter((fact) => !facts.has(fact)),
  );
  return missing.some((lacking) => lacking.length === 0) ? [] : missing;
}

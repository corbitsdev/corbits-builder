import type { Fact } from "@corbits-builder/plugin";

// A fact that names one of a plugin's input fields, such as "filed:{kind}", or "live:{address}"
// that a check makes.
const TEMPLATE = /^(\w+):\{(\w+)\}$/;

// A fact about one kind of filed document, such as "filed:build_plan".
const PATTERN = /^(filed|approved):(\w+)$/;

/** The input field a templated fact names, or undefined for a plain fact. */
export const templateField = (fact: Fact) => TEMPLATE.exec(fact)?.[2];

/** The state and document kind of a fact about one kind of document, or undefined for any other fact. */
export function patternFact(fact: Fact) {
  const match = PATTERN.exec(fact);
  return match ? { state: match[1]!, kind: match[2]! } : undefined;
}

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

/** The fact a negated one, such as "!app_exists", says must not hold; undefined for any other. */
export const negated = (fact: Fact) =>
  fact.startsWith("!") ? fact.slice(1) : undefined;

/** Whether an action's finished work makes a fact true; "filed:{kind}" makes any document filed. */
export const makes = (made: Fact, fact: Fact) =>
  made === fact ||
  (templateField(made) !== undefined &&
    made.split(":")[0] === fact.split(":")[0]);

// A template no input has filled holds when any document is in its state, as "filed:{kind}" does
// once something is filed: what discover can say before the coordinator picks the documents.
export function holds(fact: Fact, facts: ReadonlySet<Fact>) {
  const not = negated(fact);
  if (not !== undefined) return !facts.has(not);
  if (templateField(fact) !== undefined)
    return [...facts].some((known) => makes(fact, known));
  return facts.has(fact);
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
    alternative.filter((fact) => !holds(fact, facts)),
  );
  return missing.some((lacking) => lacking.length === 0) ? [] : missing;
}

/** The facts a route step's approval asks for: approved:<kind> for each document, design_chosen for the design. */
export const approvalFacts = (
  approval: { of: readonly string[] } | undefined,
) =>
  (approval?.of ?? []).map((what) =>
    what === "design" ? "design_chosen" : `approved:${what}`,
  );

/**
 * Whether a message touches a document a specialist at work is building
 * from. The designer works from the brief, constraints, approaches and requirements; the builder
 * from those, the build plan and the design. A message is about a document
 * when it names it: its title, which a quoted passage carries, or its short
 * name.
 */
import { escapeRegExp, shortDocumentName } from "./collaboration.ts";

const BUILDS_FROM: Readonly<Record<string, readonly string[]>> = {
  designer: [
    "problem_brief",
    "constraints",
    "approaches",
    "product_requirements",
  ],
  coder: [
    "problem_brief",
    "constraints",
    "approaches",
    "product_requirements",
    "build_plan",
    "design",
  ],
};

function names(text: string, phrase: string): boolean {
  return new RegExp(`\\b${escapeRegExp(phrase.trim())}\\b`, "i").test(text);
}

/** The role at work whose source the message names, if any. */
export function earlierDocumentRole(
  text: string,
  documents: readonly { readonly kind: string; readonly title: string }[],
  rolesAtWork: ReadonlySet<string>,
): string | undefined {
  for (const [role, kinds] of Object.entries(BUILDS_FROM)) {
    if (!rolesAtWork.has(role)) continue;
    const named = documents.some(
      (document) =>
        kinds.includes(document.kind) &&
        (names(text, document.title) ||
          names(text, shortDocumentName(document.kind, document.title))),
    );
    if (named) return role;
  }
  return undefined;
}

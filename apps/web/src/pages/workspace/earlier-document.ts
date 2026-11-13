/**
 * Whether a message touches a document a specialist at work is building
 * from, as its role declares. A message is about a document when it names
 * it: its title, which a quoted passage carries, or its short name.
 */
import { escapeRegExp, shortDocumentName } from "./collaboration.ts";
import { roleOf } from "./roles.ts";

function names(text: string, phrase: string): boolean {
  return new RegExp(`\\b${escapeRegExp(phrase.trim())}\\b`, "i").test(text);
}

/** The role at work whose source the message names, if any. */
export function earlierDocumentRole(
  text: string,
  documents: readonly { readonly kind: string; readonly title: string }[],
  rolesAtWork: ReadonlySet<string>,
): string | undefined {
  for (const role of rolesAtWork) {
    const kinds = roleOf(role)?.buildsFrom ?? [];
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

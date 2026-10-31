/**
 * The collaboration surface: a document the person can open, and the
 * question asked before a recorded approval. Titles only — never ids.
 */
import { wording } from "../../config.ts";

export type NamedDocument = {
  readonly id: string;
  readonly title: string;
};

export type ProseSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "document"; readonly id: string; readonly title: string };

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Split prose so each known document title can be its own control. */
export function proseSegments(
  text: string,
  documents: readonly NamedDocument[],
): readonly ProseSegment[] {
  const named = documents
    .filter((document) => document.title.trim().length >= 3)
    .sort((left, right) => right.title.length - left.title.length);
  if (named.length === 0 || text.length === 0) return [{ kind: "text", text }];
  const segments: ProseSegment[] = [];
  let index = 0;
  while (index < text.length) {
    let found:
      | { start: number; end: number; id: string; title: string }
      | undefined;
    const rest = text.slice(index);
    for (const document of named) {
      const match = new RegExp(
        `\\b${escapeRegExp(document.title)}\\b`,
        "i",
      ).exec(rest);
      if (match === null || match.index === undefined) continue;
      const start = index + match.index;
      const end = start + match[0].length;
      if (
        found === undefined ||
        start < found.start ||
        (start === found.start && end > found.end)
      ) {
        found = { start, end, id: document.id, title: match[0] };
      }
    }
    if (found === undefined) {
      segments.push({ kind: "text", text: text.slice(index) });
      break;
    }
    if (found.start > index)
      segments.push({ kind: "text", text: text.slice(index, found.start) });
    segments.push({ kind: "document", id: found.id, title: found.title });
    index = found.end;
  }
  return segments;
}

type FiledDocument = {
  readonly kind: string;
  readonly version: number;
  readonly approvedVersion?: number;
};

// The ask that approves filed documents, the kinds it names.
export const APPROVES_KINDS = "request_approval";
// Hand-offs whose approval signs off every filed document they build from.
const APPROVES_SOURCES = new Set(["design_app"]);
// Output a hand-off never builds from as a source document.
const NOT_A_SOURCE = new Set(["app", "design", "design_option"]);

/**
 * The documents an ask approves, oldest first, from the native ask and the filed list. The
 * designer's ask approves its draft, which is not filed until they approve.
 * The builder's asks cover every document, so none is singled out.
 */
export function approvedDocuments<T extends FiledDocument>(
  ask: { readonly toolName?: string; readonly kinds?: readonly string[] },
  documents: readonly T[],
): T[] {
  if (ask.toolName !== APPROVES_KINDS) return [];
  return documents.filter((item) => ask.kinds?.includes(item.kind)).reverse();
}

/** The filed documents an ask signs off together, oldest first, as the card lists them. */
export function sourceDocuments<T extends FiledDocument>(
  ask: { readonly toolName?: string },
  documents: readonly T[],
): T[] | undefined {
  if (ask.toolName === undefined || !APPROVES_SOURCES.has(ask.toolName))
    return undefined;
  return documents.filter((item) => !NOT_A_SOURCE.has(item.kind)).reverse();
}

type TitledDocument = FiledDocument & { readonly title: string };

const cardDocument = ({ kind, title, version }: TitledDocument) => ({
  kind,
  title,
  version,
});

/** The documents an ask's card names: the one it singles out, or the ones it signs off together. */
export function cardDocuments(
  ask: { readonly toolName?: string; readonly kinds?: readonly string[] },
  documents: readonly TitledDocument[],
) {
  const approving = approvedDocuments(ask, documents);
  const approved = approving.length === 1 ? approving[0] : undefined;
  const sources =
    sourceDocuments(ask, documents) ??
    (approving.length > 1 ? approving : undefined);
  return {
    ...(approved === undefined ? {} : { document: cardDocument(approved) }),
    ...(sources === undefined ? {} : { sources: sources.map(cardDocument) }),
  };
}

/** A document's name as the approval card says it: "requirements", "build plan". */
export function shortDocumentName(kind: string, title: string): string {
  return wording.approval.shortName[kind] ?? documentPhrase(title);
}

/**
 * The card's question: the ask's own, else one about the document it approves,
 * else one naming the tool ("browser.browser_navigate" as "browser navigate").
 */
export function approvalQuestion(
  toolName: string | undefined,
  document: string,
  subject?: string,
): string {
  const asked =
    toolName === undefined ? undefined : wording.approval.question[toolName];
  if (asked !== undefined) return asked(subject);
  if (document !== "" || toolName === undefined)
    return wording.approval.document(document);
  const tool = toolName
    .slice(toolName.lastIndexOf(".") + 1)
    .replaceAll("_", " ");
  return wording.approval.tool(tool, subject);
}

/** A document's title as it reads mid-sentence. */
export function documentPhrase(documentTitle: string): string {
  const name = documentTitle.trim();
  // A title-cased name ("Weather App Brief") is a proper name and keeps its case.
  const titleCased = /\s[A-Z]/.test(name);
  const lower = titleCased
    ? name
    : name.charAt(0).toLowerCase() + name.slice(1);
  return lower.startsWith("the ") ? lower.slice(4) : lower;
}

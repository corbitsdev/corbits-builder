/**
 * Comments the person leaves on passages of a project's documents. Each is a draft in this browser
 * tab until the person sends them: which drafts exist, which belong on the document shown and how
 * each card reads there, whether they can be sent now, the one message they make, and what is left
 * once it went out. Plain data in, plain data out, so each rule is tested without a hub.
 */
import { formatPassageQuote } from "./passage-quote.ts";

/** A comment on a passage, kept until it is sent. */
export type CommentDraft = {
  id: string;
  /** The document it is on, by the room's key for it, which stays the same across versions. */
  document: string;
  /** The document's title and the version the passage was quoted from, which its message names. */
  title: string;
  version: number;
  /** The passage's words, as the page shows them, and which run of them there it is. */
  quote: string;
  occurrence: number;
  comment: string;
};

/** Where the drafts of one project are kept, beside the message typed there. */
export const draftsKey = (projectId: string) => `unsent:comments:${projectId}`;

const isDraft = (value: unknown): value is CommentDraft => {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.id === "string" &&
    typeof draft.document === "string" &&
    typeof draft.title === "string" &&
    typeof draft.version === "number" &&
    Number.isInteger(draft.version) &&
    typeof draft.quote === "string" &&
    draft.quote.trim() !== "" &&
    typeof draft.occurrence === "number" &&
    Number.isInteger(draft.occurrence) &&
    typeof draft.comment === "string" &&
    draft.comment.trim() !== ""
  );
};

/**
 * The drafts as stored, where nothing stored reads as the empty string; anything stored that is not
 * a whole draft is left out.
 */
export function readDrafts(stored: string): CommentDraft[] {
  if (stored === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  return Array.isArray(parsed) ? parsed.filter(isDraft) : [];
}

/** What to store for the drafts; with none left, the empty string, which keeps nothing. */
export function storedDrafts(drafts: readonly CommentDraft[]): string {
  return drafts.length === 0 ? "" : JSON.stringify(drafts);
}

/** Saves a draft: a new one goes last, an edited one keeps its place. */
export function saveDraft(
  drafts: readonly CommentDraft[],
  draft: CommentDraft,
): CommentDraft[] {
  const comment = draft.comment.trim();
  if (comment === "" || draft.quote.trim() === "") return [...drafts];
  const saved = { ...draft, comment };
  return drafts.some((item) => item.id === draft.id)
    ? drafts.map((item) => (item.id === draft.id ? saved : item))
    : [...drafts, saved];
}

export function deleteDraft(
  drafts: readonly CommentDraft[],
  id: string,
): CommentDraft[] {
  return drafts.filter((item) => item.id !== id);
}

/** The drafts on one document, whichever version is shown, in the order they were written. */
export function documentDrafts(
  drafts: readonly CommentDraft[],
  document: string,
): CommentDraft[] {
  return drafts.filter((item) => item.document === document);
}

/**
 * How a draft's card reads on the page: level with its passage, or, when that passage is not
 * on the version shown, at the top of the margin with its quote above it so
 * the person still sees what it was about.
 */
export function draftCard(found: boolean): {
  place: "passage" | "top";
  showsQuote: boolean;
} {
  return found
    ? { place: "passage", showsQuote: false }
    : { place: "top", showsQuote: true };
}

/** The document the box's comments open: the one on screen when it has any, else the first. */
export function commentedDocument(
  drafts: readonly CommentDraft[],
  shown: string | null,
): string | undefined {
  return (drafts.find((draft) => draft.document === shown) ?? drafts[0])
    ?.document;
}

/** Puts back drafts removed together, ahead of any written since. */
export function restoreDrafts(
  drafts: readonly CommentDraft[],
  removed: readonly CommentDraft[],
): CommentDraft[] {
  return [
    ...removed.filter((gone) => !drafts.some((draft) => draft.id === gone.id)),
    ...drafts,
  ];
}

/** Whether Send comments can send now, and what to deal with first when it cannot. */
export type CommentsSend =
  | { state: "none" }
  | { state: "ready" }
  | { state: "sending" }
  /** A message sent now would answer the question or decline the approval. */
  | { state: "blocked"; by: "question" | "approval" };

export function commentsSend({
  drafts,
  sending,
  question,
  approval,
}: {
  drafts: readonly CommentDraft[];
  sending: boolean;
  question: boolean;
  approval: boolean;
}): CommentsSend {
  if (drafts.length === 0) return { state: "none" };
  if (sending) return { state: "sending" };
  if (question) return { state: "blocked", by: "question" };
  if (approval) return { state: "blocked", by: "approval" };
  return { state: "ready" };
}

/**
 * The one message every draft makes: each quote's line, then the comment under it, and last any
 * words the person typed beside them.
 */
export function commentsMessage(
  drafts: readonly CommentDraft[],
  words = "",
): string {
  return [
    ...drafts.map((draft) => `${formatPassageQuote(draft)}${draft.comment}`),
    ...(words.trim() === "" ? [] : [words.trim()]),
  ].join("\n\n");
}

/**
 * The drafts left once a message went out: those it carried are cleared, and any written or
 * changed while it was on its way are kept.
 */
export function afterSent(
  drafts: readonly CommentDraft[],
  sent: readonly CommentDraft[],
): CommentDraft[] {
  return drafts.filter(
    (draft) =>
      !sent.some(
        (item) => item.id === draft.id && item.comment === draft.comment,
      ),
  );
}

/**
 * Comments on a written page: selecting a passage opens a card to write about it in the margin,
 * a saved comment is a draft card level with its passage that can be edited or deleted, and a
 * draft whose passage is not on the version shown heads the margin with its quote above it.
 */
import {
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CommentCard } from "./comment-card.tsx";
import { draftCard } from "./comments.ts";
import type { MarginPassage, PassagePlace } from "./document-page.tsx";
import styles from "./page-comments.module.css";

/** The person's comments on the document shown, and saving or deleting one. */
export type PageComments = {
  drafts: readonly { id: string; quote: string; comment: string }[];
  /** Saves a comment: a new one has no id yet. */
  onSave: (draft: {
    id: string | null;
    quote: string;
    comment: string;
  }) => void;
  onDelete: (id: string) => void;
};

// The passage being written about before it is saved has no draft of its own yet.
const NEW = "comment:new";

/**
 * The words of a selection as the page's text holds them, element boundaries and all, so the page
 * finds the passage again from them.
 */
function rangeText(range: Range): string {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE)
    return (root.textContent ?? "").slice(range.startOffset, range.endOffset);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const words = node.textContent ?? "";
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : words.length;
    text += words.slice(start, end);
  }
  return text;
}

export function usePageComments(
  comments: PageComments | undefined,
  textRef: RefObject<HTMLElement | null>,
): {
  passages: readonly MarginPassage[] | undefined;
  margin: ((place: PassagePlace, pointed: boolean) => ReactNode) | undefined;
  /** Takes up a saved comment from its passage, to edit it. */
  press: ((id: string) => void) | undefined;
  /** Takes what the person selects in the text as the passage to write about. */
  select: { onMouseUp: () => void; onKeyUp: (event: KeyboardEvent) => void };
  /** The passage being written about, made wider or narrower by its handles. */
  resize: ((id: string, range: Range) => void) | undefined;
} {
  // The comment being written: a new one on a selected passage, or a saved one being edited.
  const [writing, setWriting] = useState<{
    id: string | null;
    quote: string;
  } | null>(null);

  const take = () => {
    const text = textRef.current;
    const selection = window.getSelection();
    if (
      comments === undefined ||
      text === null ||
      selection === null ||
      selection.isCollapsed ||
      selection.rangeCount === 0
    )
      return;
    const range = selection.getRangeAt(0);
    if (!text.contains(range.commonAncestorContainer)) return;
    const quote = rangeText(range).trim();
    if (quote === "") return;
    setWriting({ id: null, quote });
    // The passage stays marked as selected while its card is open, in place of the browser's own.
    selection.removeAllRanges();
  };

  if (comments === undefined)
    return {
      passages: undefined,
      margin: undefined,
      select: { onMouseUp: () => {}, onKeyUp: () => {} },
      resize: undefined,
      press: undefined,
    };

  const { drafts, onSave, onDelete } = comments;
  const passages: MarginPassage[] = drafts.map((draft) =>
    writing?.id === draft.id
      ? { id: draft.id, quote: writing.quote, state: "selected" }
      : { id: draft.id, quote: draft.quote },
  );
  if (writing !== null && writing.id === null)
    passages.push({ id: NEW, quote: writing.quote, state: "selected" });

  const margin = (place: PassagePlace, pointed: boolean): ReactNode => {
    const draft = drafts.find((item) => item.id === place.id);
    const editing =
      writing !== null &&
      (place.id === NEW ? writing.id === null : writing.id === place.id);
    if (draft === undefined && !editing) return null;
    // A comment being written takes the passage as its handles have left it.
    const quote = editing
      ? (writing?.quote ?? place.quote)
      : (draft?.quote ?? place.quote);
    const card = editing ? (
      <CommentCard
        state="writing"
        comment={draft?.comment ?? ""}
        paired
        onSave={(comment) => {
          onSave({ id: draft?.id ?? null, quote, comment });
          setWriting(null);
        }}
        onCancel={() => setWriting(null)}
      />
    ) : (
      <CommentCard
        state="saved"
        comment={draft?.comment ?? ""}
        paired={pointed}
        onEdit={() => setWriting({ id: place.id, quote })}
        onDelete={() => onDelete(place.id)}
      />
    );
    if (!draftCard(place.found).showsQuote) return card;
    return (
      <div className={styles.away} data-slot="comment-away">
        <blockquote className={styles.quote}>{quote}</blockquote>
        {card}
      </div>
    );
  };

  return {
    passages,
    margin,
    press: (id) => {
      const draft = drafts.find((item) => item.id === id);
      if (draft !== undefined) setWriting({ id, quote: draft.quote });
    },
    resize: (_id, range) => {
      const quote = rangeText(range).trim();
      if (quote === "") return;
      setWriting((was) => (was === null ? was : { ...was, quote }));
    },
    select: {
      onMouseUp: take,
      // A selection made from the keyboard is taken once the keys that made it are let go.
      onKeyUp: (event) => {
        if (event.shiftKey || event.key === "Shift") take();
      },
    },
  };
}

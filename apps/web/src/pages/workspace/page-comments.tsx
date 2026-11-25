/**
 * Comments on a written page: selecting a passage opens a card to write about it in the margin,
 * a saved comment is a draft card level with its passage that can be edited or deleted, and a
 * draft whose passage is not on the version shown heads the margin with its quote above it.
 */
import {
  useEffect,
  useEffectEvent,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { CommentCard } from "./comment-card.tsx";
import { draftCard } from "./comments.ts";
import {
  occurrenceAt,
  type MarginPassage,
  type PassagePlace,
} from "./document-page.tsx";
import styles from "./page-comments.module.css";

/** The words a comment is about and which run of them on the page it is. */
type Passage = Pick<MarginPassage, "quote" | "occurrence">;

/** The person's comments on the document shown, and saving or deleting one. */
export type PageComments = {
  drafts: readonly (Passage & { id: string; comment: string })[];
  /** Saves a comment: a new one has no id yet. */
  onSave: (draft: Passage & { id: string | null; comment: string }) => void;
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
    return (root as Text).data.slice(range.startOffset, range.endOffset);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const words = (node as Text).data;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : words.length;
    text += words.slice(start, end);
  }
  return text;
}

/** The passage a range of the document's text covers, or null when it holds no words. */
function passageOf(text: HTMLElement, range: Range): Passage | null {
  const words = rangeText(range);
  const quote = words.trim();
  if (quote === "") return null;
  const before = document.createRange();
  before.setStart(text, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const start =
    rangeText(before).length + words.length - words.trimStart().length;
  return { quote, occurrence: occurrenceAt(text.textContent, quote, start) };
}

// The browser's selection is cleared once a passage is taken, and the card's field has focus, so
// Cmd+C with nothing selected in the field copies the passage the card is about.
function copyPassage(event: ClipboardEvent<HTMLElement>, quote: string) {
  const field = event.target;
  if (
    field instanceof HTMLTextAreaElement &&
    field.selectionStart !== field.selectionEnd
  )
    return;
  event.clipboardData.setData("text/plain", quote);
  event.preventDefault();
}

export function usePageComments(
  comments: PageComments | undefined,
  textRef: RefObject<HTMLElement | null>,
): {
  passages: readonly MarginPassage[] | undefined;
  margin: ((place: PassagePlace, pointed: boolean) => ReactNode) | undefined;
  /** Takes up a saved comment from its passage, to edit it. */
  press: ((id: string) => void) | undefined;
  /** Takes what the person selects in the text from the keyboard as the passage to write about. */
  select: { onKeyUp: (event: KeyboardEvent) => void };
  /** The passage being written about, made wider or narrower by its handles. */
  resize: ((id: string, range: Range) => void) | undefined;
} {
  // The comment being written: a new one on a selected passage, or a saved one being edited.
  const [writing, setWriting] = useState<
    (Passage & { id: string | null }) | null
  >(null);

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
    const passage = passageOf(text, range);
    if (passage === null) return;
    setWriting({
      id: null,
      quote: passage.quote,
      occurrence: passage.occurrence,
    });
    // The passage stays marked as selected while its card is open, in place of the browser's own.
    selection.removeAllRanges();
  };

  // A drag that selects the text is taken wherever it is let go, on the text or off it.
  const takeDrag = useEffectEvent(take);
  useEffect(() => {
    const onRelease = () => takeDrag();
    document.addEventListener("mouseup", onRelease);
    return () => document.removeEventListener("mouseup", onRelease);
  }, []);

  if (comments === undefined)
    return {
      passages: undefined,
      margin: undefined,
      select: { onKeyUp: () => {} },
      resize: undefined,
      press: undefined,
    };

  const { drafts, onSave, onDelete } = comments;
  const passages: MarginPassage[] = drafts.map((draft) =>
    writing?.id === draft.id
      ? {
          id: draft.id,
          quote: writing.quote,
          occurrence: writing.occurrence,
          state: "selected",
        }
      : { id: draft.id, quote: draft.quote, occurrence: draft.occurrence },
  );
  if (writing !== null && writing.id === null)
    passages.push({
      id: NEW,
      quote: writing.quote,
      occurrence: writing.occurrence,
      state: "selected",
    });

  const margin = (place: PassagePlace, pointed: boolean): ReactNode => {
    const draft = drafts.find((item) => item.id === place.id);
    const editing =
      writing !== null &&
      (place.id === NEW ? writing.id === null : writing.id === place.id);
    if (draft === undefined && !editing) return null;
    // A comment being written takes the passage as its handles have left it.
    const { quote, occurrence } = editing
      ? (writing ?? place)
      : (draft ?? place);
    const card = editing ? (
      <CommentCard
        state="writing"
        // A new comment starts with nothing written.
        comment={draft === undefined ? "" : draft.comment}
        paired
        onCopy={(event) => copyPassage(event, quote)}
        onSave={(comment) => {
          onSave({ id: draft?.id ?? null, quote, occurrence, comment });
          setWriting(null);
        }}
        onCancel={() => setWriting(null)}
      />
    ) : draft === undefined ? null : (
      <CommentCard
        state="saved"
        comment={draft.comment}
        paired={pointed}
        onEdit={() => setWriting({ id: place.id, quote, occurrence })}
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
      if (draft !== undefined)
        setWriting({ id, quote: draft.quote, occurrence: draft.occurrence });
    },
    resize: (_id, range) => {
      const text = textRef.current;
      const passage = text === null ? null : passageOf(text, range);
      if (passage === null) return;
      setWriting((was) =>
        was === null
          ? was
          : {
              id: was.id,
              quote: passage.quote,
              occurrence: passage.occurrence,
            },
      );
    },
    select: {
      // A selection made from the keyboard is taken once the keys that made it are let go.
      onKeyUp: (event) => {
        if (event.shiftKey || event.key === "Shift") take();
      },
    },
  };
}

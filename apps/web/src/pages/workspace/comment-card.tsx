/**
 * A comment beside the passage it is about, in the margin or opened from the passage on its own.
 * A saved comment is a draft: it can be edited or deleted until the person sends it.
 */
import { Button as UiButton } from "@corbits/react-ui";
import { ArrowUp, Pencil, Trash2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { Fault } from "../../components.tsx";
import { wording } from "../../config.ts";
import styles from "./comment-card.module.css";

const text = wording.comments;

export type CommentState = "writing" | "saved";

/** Enter saves and Escape cancels; Shift+Enter, and Enter that ends an IME composition, add a line. */
export function commentKey(event: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}): "save" | "cancel" | null {
  // Safari ends a composition with an Enter whose isComposing is already false.
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.key === "Escape") return "cancel";
  if (event.key === "Enter" && !event.shiftKey) return "save";
  return null;
}

/** Fades the card out before it is removed, so it leaves rather than vanishes. */
function leave(card: HTMLElement | null, then: (() => void) | undefined) {
  if (then === undefined) return;
  if (card === null) return then();
  // Inert while it leaves, so a second press cannot remove it twice.
  card.inert = true;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The app's own timing, read off the page, so leaving keeps pace with everything else.
  const tokens = getComputedStyle(card);
  const fade = card.animate(
    still
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "scale(0.98)" },
        ],
    {
      duration:
        Number.parseFloat(tokens.getPropertyValue("--duration-micro")) || 150,
      easing: tokens.getPropertyValue("--ease-out").trim() || "ease-out",
      fill: "forwards",
    },
  );
  const settle = () => {
    flushSync(then);
    // A parent that keeps the card, because the delete failed or is still on its way, gets it
    // back rather than an invisible box that ignores every press.
    if (!card.isConnected) return;
    fade.cancel();
    card.inert = false;
  };
  fade.finished.then(settle, settle);
}

export function CommentCard({
  state,
  comment,
  paired = false,
  saving = false,
  saveFailed = false,
  onSave,
  onCancel,
  onEdit,
  onDelete,
}: {
  state: CommentState;
  /** While writing, what the field starts with. */
  comment: string;
  /** Its passage is pointed at or its card is in hand. */
  paired?: boolean;
  saving?: boolean;
  saveFailed?: boolean;
  onSave?: (comment: string) => void;
  onCancel?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const wasWriting = useRef(state === "writing");
  // A card that first shows as a field is a comment just started; one shown saved was already there.
  const [entering] = useState(state === "writing");

  // Saving or cancelling removes the field that had focus; the card keeps it, so Tab carries on
  // from here rather than from the top of the page.
  useEffect(() => {
    const leftField = wasWriting.current && state !== "writing";
    wasWriting.current = state === "writing";
    if (leftField && document.activeElement === document.body)
      cardRef.current?.focus({ preventScroll: true });
  }, [state]);

  // Every comment here is the person's own, so the card carries no name or avatar: the box is the
  // comment.
  return (
    <article
      ref={cardRef}
      className={styles.card}
      data-slot="comment-card"
      data-state={state}
      data-entering={entering ? "" : undefined}
      data-paired={paired ? "" : undefined}
      tabIndex={-1}
    >
      {state === "writing" ? (
        <CommentField
          initial={comment}
          saving={saving}
          saveFailed={saveFailed}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : (
        <p className={styles.comment}>{comment}</p>
      )}
      {state === "saved" ? (
        <span className={styles.actions}>
          <IconButton label={text.edit} onClick={onEdit}>
            <Pencil aria-hidden="true" />
          </IconButton>
          <IconButton
            label={text.remove}
            onClick={() => leave(cardRef.current, onDelete)}
          >
            <Trash2 aria-hidden="true" />
          </IconButton>
        </span>
      ) : null}
    </article>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <UiButton
      variant="ghost"
      size="icon"
      className={styles.iconButton}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </UiButton>
  );
}

function CommentField({
  initial,
  saving,
  saveFailed,
  onSave,
  onCancel,
}: {
  initial: string;
  saving: boolean;
  saveFailed: boolean;
  onSave: ((comment: string) => void) | undefined;
  onCancel: (() => void) | undefined;
}) {
  const [draft, setDraft] = useState(initial);
  // Once the words wrap, the send button drops beneath them. It stays there until the field is
  // cleared, so a draft on the edge of one line does not flip between the two layouts.
  const [wrapped, setWrapped] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const empty = draft.trim().length === 0;

  // The card opens beside the passage the person is looking at, but takes its place there only
  // once the page has measured it; focus that scrolled to it would carry the page off to where it
  // first sat. The cursor goes after any words it opens with.
  useEffect(() => {
    const field = fieldRef.current;
    if (field === null) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  // A press anywhere else puts the comment away, and its passage with it, while doing so loses
  // nothing: the field is empty, or still holds the comment it opened with. Words written stay.
  // The passage's own handles are part of writing it, so taking hold of one keeps the card.
  const latest = useRef({ draft, onCancel });
  useLayoutEffect(() => {
    latest.current = { draft, onCancel };
  });
  useEffect(() => {
    const away = (event: PointerEvent) => {
      const card =
        fieldRef.current?.closest('[data-slot="comment-card"]') ?? null;
      if (
        card === null ||
        (event.target instanceof Node && card.contains(event.target)) ||
        (event.target instanceof Element &&
          event.target.closest('[data-slot="passage-handle"]') !== null)
      )
        return;
      const { draft: now, onCancel: cancel } = latest.current;
      if (now.trim() === "" || now === initial) cancel?.();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [initial]);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (field === null) return;
    field.style.height = "auto";
    field.style.height = `${String(field.scrollHeight)}px`;
    const style = getComputedStyle(field);
    const lines =
      (field.scrollHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom)) /
      parseFloat(style.lineHeight);
    if (draft === "") setWrapped(false);
    else if (lines > 1.5) setWrapped(true);
  }, [draft, wrapped]);

  const save = () => {
    if (empty || saving) return;
    onSave?.(draft.trim());
  };

  return (
    <div className={styles.writing}>
      <div className={styles.field} data-wrapped={wrapped ? "" : undefined}>
        <textarea
          ref={fieldRef}
          className={styles.input}
          rows={1}
          value={draft}
          placeholder={text.placeholder}
          aria-label={text.field}
          aria-invalid={saveFailed ? true : undefined}
          enterKeyHint="done"
          autoCapitalize="sentences"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            const intent = commentKey({
              key: event.key,
              shiftKey: event.shiftKey,
              isComposing: event.nativeEvent.isComposing,
              keyCode: event.nativeEvent.keyCode,
            });
            if (intent === null) return;
            event.preventDefault();
            if (intent === "save") save();
            else onCancel?.();
          }}
        />
        <UiButton
          size="icon"
          className={styles.save}
          aria-label={text.save}
          title={text.save}
          disabled={empty}
          aria-busy={saving}
          onClick={save}
        >
          <ArrowUp aria-hidden="true" />
        </UiButton>
      </div>
      {saveFailed ? <Fault>{text.saveFailed}</Fault> : null}
    </div>
  );
}

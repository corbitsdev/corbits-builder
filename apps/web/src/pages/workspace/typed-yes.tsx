/**
 * A plain "yes" typed while exactly one approval card is open answers that card: it approves
 * after a short countdown the person can undo, and undoing sends the words as a message instead.
 */
import { useEffect, useRef, useState } from "react";
import { Button as UiButton } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import styles from "./typed-yes.module.css";

const text = wording.approval.typedYes;
const SECONDS = 5;
const AFFIRMATIONS = new Set(text.affirmations);

/** The whole message is one of the plain affirmations, ignoring case and punctuation. */
export function isAffirmation(message: string): boolean {
  const words = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
  return AFFIRMATIONS.has(words);
}

export type TypedYes = {
  readonly approvalId: string;
  readonly message: string;
  readonly endsAt: number;
};

/** Holds a typed yes against the one open approval until its countdown ends or it is undone. */
export function useTypedYes({
  pending,
  onApprove,
  onUndo,
  onDropped,
}: {
  /** The open approval cards, by id; undefined until the open decisions are read. */
  pending: readonly string[] | undefined;
  onApprove: (approvalId: string) => void;
  onUndo: (message: string) => void;
  /** The card was answered some other way during the countdown. */
  onDropped: (message: string) => void;
}) {
  const [held, setHeld] = useState<TypedYes | null>(null);
  const actions = useRef({ onApprove, onUndo, onDropped });
  actions.current = { onApprove, onUndo, onDropped };

  const undo = () => {
    if (held === null) return;
    setHeld(null);
    actions.current.onUndo(held.message);
  };

  useEffect(() => {
    if (held === null) return;
    const timer = setTimeout(() => {
      setHeld(null);
      actions.current.onApprove(held.approvalId);
    }, held.endsAt - Date.now());
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setHeld(null);
      actions.current.onUndo(held.message);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, [held]);

  const open = held !== null && pending?.includes(held.approvalId) === true;
  useEffect(() => {
    if (held === null || open) return;
    setHeld(null);
    actions.current.onDropped(held.message);
  }, [held, open]);

  /** Holds the message when it answers the one open card; false means send it as usual. */
  const hold = (message: string): boolean => {
    if (pending === undefined) return false;
    const [only] = pending;
    if (
      held !== null ||
      pending.length !== 1 ||
      only === undefined ||
      !isAffirmation(message)
    )
      return false;
    setHeld({
      approvalId: only,
      message,
      endsAt: Date.now() + SECONDS * 1_000,
    });
    return true;
  };

  return { held, hold, undo };
}

/**
 * Sends a message while a coordinator approval card may be open. The parked coordinator wakes
 * only once the card is declined: `decline` sends the message as the decline's reason, so the
 * coordinator reads the person's words as their answer; without it the card is declined
 * first and the message follows.
 */
export async function deliverWithOpenApproval({
  openApprovalId,
  decide,
  deliver,
  decline,
}: {
  openApprovalId: string | undefined;
  decide: (decision: {
    approvalId: string;
    choice: "yes" | "always" | "no";
  }) => Promise<string | null>;
  deliver: () => Promise<boolean>;
  decline?: (approvalId: string) => Promise<boolean>;
}): Promise<boolean> {
  if (openApprovalId !== undefined && decline !== undefined)
    return decline(openApprovalId);
  if (openApprovalId !== undefined) {
    const fault = await decide({ approvalId: openApprovalId, choice: "no" });
    if (fault !== null) return false;
  }
  return deliver();
}

/**
 * Picks an approach while a coordinator approval card may be open: approves when the open
 * card asks about the chosen version, or declines any other open coordinator card with the
 * choice as the person's reason.
 */
export async function chooseApproachWithOpenApproval({
  askedApprovalId,
  openApprovalId,
  decide,
  deliver,
  decline,
  notSent,
}: {
  askedApprovalId: string | undefined;
  openApprovalId: string | undefined;
  decide: (decision: {
    approvalId: string;
    choice: "yes" | "always" | "no";
  }) => Promise<string | null>;
  deliver: () => Promise<boolean>;
  decline: (approvalId: string) => Promise<boolean>;
  notSent: string;
}): Promise<string | null> {
  if (askedApprovalId !== undefined) {
    const fault = await decide({ approvalId: askedApprovalId, choice: "yes" });
    if (fault !== null) return fault;
  } else if (openApprovalId !== undefined)
    return (await decline(openApprovalId)) ? null : notSent;
  return (await deliver()) ? null : notSent;
}

/** The countdown on the card it will approve, with its undo. */
export function TypedYesCountdown({
  held,
  onUndo,
}: {
  held: TypedYes;
  onUndo: () => void;
}) {
  const left = () => Math.max(0, Math.ceil((held.endsAt - Date.now()) / 1_000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    const tick = setInterval(() => setSeconds(left()), 250);
    return () => clearInterval(tick);
  }, [held]);
  return (
    <div className={styles.countdown} role="status">
      <span className={styles.count}>{text.countdown(seconds)}</span>
      <span
        className={styles.bar}
        aria-hidden="true"
        style={{ animationDuration: `${String(SECONDS)}s` }}
      />
      <UiButton
        type="button"
        variant="link"
        size="sm"
        title={text.undoHint}
        aria-keyshortcuts="Escape"
        onClick={onUndo}
      >
        {text.undo}
      </UiButton>
    </div>
  );
}

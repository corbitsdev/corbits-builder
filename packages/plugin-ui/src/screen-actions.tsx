/**
 * A question's one row of actions: the view's main action first, then its others, then Cancel, with
 * a quiet note beneath. Cancel, and why the last answer was not sent, come from the host through
 * `ScreenRow`, so every screen withdraws its question and says it failed the same way, inside its
 * own card, without each view wiring it. For a screen that declares a decision, the host's
 * `ScreenDecision` puts its accept control here too, so every such screen is accepted the same way.
 * While an answer is on its way the host makes the whole screen inert, so no control here disables
 * itself.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@corbits/react-ui";
import styles from "./screen-actions.module.css";

export type ScreenRow = {
  cancel: { label: string; onCancel: () => void };
  /** On the page, back to the conversation with the question still open and its draft kept. */
  back: { label: string; onBack: () => void } | null;
  /** Why the last answer was not sent, one sentence above the buttons that send it again. */
  fault: ReactNode;
};

/** What the host puts around a screen so its row of actions can withdraw it and say it failed. */
export const ScreenRow = createContext<ScreenRow | null>(null);

/** A screen's decision as the host answers it: accept, or send back what is pending. */
export type DecisionControls = {
  /** What accepting is called, such as "Approve". */
  accept: string;
  /** Accepts; null while the screen cannot be accepted yet. */
  onAccept: (() => void) | null;
  /** Why the screen cannot be accepted yet, if it says. */
  unavailable: string | undefined;
  /** The items the screen would send back, such as "2 comments"; null while there are none. */
  pending: string | null;
  /** The prompt box holds words, which send it back. */
  drafted: boolean;
};

/** What the host puts around a screen that declares a decision. */
export const ScreenDecision = createContext<DecisionControls | null>(null);

export const decisionText = {
  anyway: (accept: string) => `${accept} anyway`,
  discard: (accept: string, pending: string) =>
    `${accept} and discard ${pending}?`,
  unsent: (accept: string) => `${accept} without sending what you typed?`,
  keep: "Keep reviewing",
};

/** Where the confirmation stands: closed, open, or closed again by keep reviewing. */
export type Asking = "closed" | "open" | "kept";

/** What a press does: whether it accepts, and where the confirmation stands after it. */
export function pressed(
  press: "accept" | "confirm" | "keep",
  pending: boolean,
): { accepts: boolean; asking: Asking } {
  if (press === "keep") return { accepts: false, asking: "kept" };
  if (press === "accept" && pending) return { accepts: false, asking: "open" };
  return { accepts: true, asking: "closed" };
}

/** Whether anything would be lost by accepting now. */
export const isPending = (decision: DecisionControls) =>
  decision.pending !== null || decision.drafted;

export function ScreenActions({
  note,
  children,
}: {
  /** A quiet line beneath the buttons, such as why the main one is disabled. */
  note?: ReactNode;
  /** The view's own small buttons, its main action first; Cancel follows them. */
  children?: ReactNode;
}) {
  const row = useContext(ScreenRow);
  const decision = useContext(ScreenDecision);
  const [asking, setAsking] = useState<Asking>("closed");
  const pending = decision !== null && isPending(decision);
  const press = (what: "accept" | "confirm" | "keep") => {
    const next = pressed(what, pending);
    setAsking(next.asking);
    if (next.accepts) decision?.onAccept?.();
  };
  const shownNote = decision?.unavailable ?? note;
  // The row's buttons trade places as the confirmation opens and closes, so focus goes where the
  // person's next press is safe: keep reviewing, then back to accept.
  const keep = useRef<HTMLButtonElement>(null);
  const accept = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking === "open") keep.current?.focus();
    if (asking === "kept") accept.current?.focus();
  }, [asking]);
  useEffect(() => {
    if (!pending) setAsking("closed");
  }, [pending]);
  // Once nothing is pending there is nothing to lose, so the confirmation gives way to accept.
  if (decision !== null && pending && asking === "open") {
    const question =
      decision.pending === null
        ? decisionText.unsent(decision.accept)
        : decisionText.discard(decision.accept, decision.pending);
    return (
      <div className={styles.actions} data-slot="screen-actions">
        {row?.fault}
        <div
          key="confirm"
          className={styles.buttons}
          role="group"
          aria-label={question}
          data-slot="screen-confirm"
          onKeyDown={(event) => {
            if (event.key === "Escape") press("keep");
          }}
        >
          <span className={styles.ask}>{question}</span>
          <Button
            type="button"
            size="sm"
            disabled={decision.onAccept === null}
            onClick={() => press("confirm")}
          >
            {decision.accept}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            ref={keep}
            onClick={() => press("keep")}
          >
            {decisionText.keep}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.actions} data-slot="screen-actions">
      {row?.fault}
      <div key="row" className={styles.buttons}>
        {children}
        {decision === null ? null : (
          <Button
            type="button"
            size="sm"
            variant={pending ? "outline" : "primary"}
            disabled={decision.onAccept === null}
            ref={accept}
            onClick={() => press("accept")}
          >
            {pending ? decisionText.anyway(decision.accept) : decision.accept}
          </Button>
        )}
        {row?.back ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={row.back.onBack}
          >
            {row.back.label}
          </Button>
        ) : null}
        {row === null ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={row.cancel.onCancel}
          >
            {row.cancel.label}
          </Button>
        )}
      </div>
      {shownNote === undefined || shownNote === null ? null : (
        <div className={styles.note}>{shownNote}</div>
      )}
    </div>
  );
}

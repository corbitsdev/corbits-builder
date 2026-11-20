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
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@corbits/react-ui";
import styles from "./screen-actions.module.css";

export type ScreenRow = {
  /** Withdraws the question; null where the host offers its own way out, such as typing in the prompt box. */
  cancel: { label: string; onCancel: () => void } | null;
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

/**
 * Where the host draws a screen's buttons instead of under it, such as in the prompt box where
 * Send stands, so the box keeps one main action. Null draws them in place. React keeps them in the
 * screen's tree wherever they land, so the screen's keys and focus still reach them.
 */
export const ActionsSlot = createContext<
  ((buttons: ReactNode) => ReactNode) | null
>(null);

/**
 * Where the host takes what a screen in the prompt box says the box should invite, such as "Add
 * details for Concept B…" once an option is picked. Null where the screen is not in the box.
 */
export const PromptPlaceholder = createContext<
  ((placeholder: string | undefined) => void) | null
>(null);

/** Sets the prompt box's placeholder while this screen is in the box, and gives it back after. */
export function usePromptPlaceholder(placeholder: string | undefined) {
  const set = useContext(PromptPlaceholder);
  useEffect(() => {
    if (set === null) return;
    set(placeholder);
    return () => set(undefined);
  }, [set, placeholder]);
}

/**
 * Where the host draws a screen's one forward action when the screen covers the page and the prompt
 * box stays beneath it, so the action stands where Send does instead of in a second row. Null
 * draws it in the screen's own row.
 */
export const PromptAction = createContext<
  ((action: ReactNode) => ReactNode) | null
>(null);

/** Takes the words the person sends from the prompt box; whether the screen took them. */
export type PromptTake = (words: string) => boolean;

/**
 * Where the host hands a screen in the prompt box what the person sends from it, so words typed
 * after a pick go with the pick rather than replacing it. Null where the screen is not in the box.
 */
export const PromptSend = createContext<
  ((take: PromptTake | undefined) => void) | null
>(null);

/** Takes what the prompt box sends while this screen is in it and `take` is given. */
export function usePromptSend(take: PromptTake | undefined) {
  const set = useContext(PromptSend);
  // The host keeps one taker for as long as the screen offers one; it reads the screen's latest.
  const latest = useRef(take);
  useLayoutEffect(() => {
    latest.current = take;
  });
  const offered = take !== undefined;
  useEffect(() => {
    if (set === null || !offered) return;
    set((words) => latest.current?.(words) ?? false);
    return () => set(undefined);
  }, [set, offered]);
}

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
  const slot = useContext(ActionsSlot);
  const place = (buttons: ReactNode) =>
    slot === null ? buttons : slot(buttons);
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
        {place(
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
          </div>,
        )}
      </div>
    );
  }
  return (
    <div className={styles.actions} data-slot="screen-actions">
      {row?.fault}
      {place(
        <div key="row" className={styles.buttons} data-slot="screen-buttons">
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
          {row?.cancel ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={row.cancel.onCancel}
            >
              {row.cancel.label}
            </Button>
          ) : null}
        </div>,
      )}
      {shownNote === undefined || shownNote === null ? null : (
        <div className={styles.note}>{shownNote}</div>
      )}
    </div>
  );
}

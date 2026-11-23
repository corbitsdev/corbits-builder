/**
 * One quiet line just above the prompt box saying what is happening now, and what pressing it
 * does. While work runs it stands where the pull handle was and does the handle's job: drag it up
 * or press it to see the chat. It never adds a progress bar; the ring of dots at its start says work is running.
 */
import type {
  CSSProperties,
  KeyboardEventHandler,
  MouseEvent,
  PointerEventHandler,
} from "react";
import { Pill } from "./pill.tsx";
import styles from "./status-pill.module.css";

export type StatusPillState =
  | "working"
  | "running"
  | "failed"
  | "ready"
  | "commentsWorking"
  | "commentsDone";

/** What the pill says and what pressing it does. */
export type StatusPillContent = {
  state: StatusPillState;
  /** What is happening, in plain words: "Writing the Problem brief". */
  label: string;
  /** What pressing it does, in a word or two: "Open", "Try again"; absent where pressing it only shows the chat. */
  action?: string | undefined;
  /** Pressing it; absent while work runs, when pressing it shows the chat. */
  onAction?: () => void;
};

/**
 * What leads the line: while work runs, a light running round a ring of ink dots; while the app is
 * up, a ring of green dots, the green the sidebar marks it with, that gathers into one and opens
 * again. Any other state's words already say it, so a tick or a still dot would only repeat them.
 */
export function StatusMark({ state }: { state: StatusPillState }) {
  if (state === "working" || state === "commentsWorking")
    return <Ring kind="orbit" dots={8} />;
  if (state === "running") return <Ring kind="bloom" dots={6} />;
  return null;
}

function Ring({ kind, dots }: { kind: "orbit" | "bloom"; dots: number }) {
  return (
    <span className={styles.lead} aria-hidden="true">
      <span
        className={styles.ring}
        data-kind={kind}
        data-slot={`${kind}-ring`}
        style={{ "--dots": dots } as CSSProperties}
      >
        {Array.from({ length: dots }, (_, index) => (
          <span key={index} style={{ "--i": index } as CSSProperties} />
        ))}
      </span>
    </span>
  );
}

export function StatusPill({
  state,
  label,
  action,
  onPress,
  onPointerDown,
  onKeyDown,
  expanded,
  controls,
}: StatusPillContent & {
  /** Absent, the pill only says what is happening and is not a control. */
  onPress?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  /** The chat's pull, which the pill starts while it stands in for the handle. */
  onPointerDown?: PointerEventHandler<HTMLButtonElement>;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  /** Whether the chat it opens is showing, where pressing it opens the chat. */
  expanded?: boolean | undefined;
  controls?: string | undefined;
}) {
  const content = (
    <>
      <StatusMark state={state} />
      <span className={styles.label} data-state={state} role="status">
        {label}
      </span>
      {action === undefined ? null : (
        <span className={styles.action}>{action}</span>
      )}
    </>
  );
  if (onPress === undefined) return <Pill as="div">{content}</Pill>;
  return (
    <Pill
      as="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onPress}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      {content}
    </Pill>
  );
}

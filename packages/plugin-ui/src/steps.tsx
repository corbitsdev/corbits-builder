/**
 * A plan's steps, two levels deep, each with a word and an icon for where it stands, and a row
 * that opens to what it did, what it showed and what it waits on. Stateless: the steps and the
 * clock come in as props; a row opens by the browser's own disclosure.
 */
import type { ReactNode } from "react";
import styles from "./steps.module.css";

export type StepState =
  | "done"
  | "failed"
  | "running"
  | "needs_you"
  | "waiting"
  | "not_started"
  | "skipped"
  | "cancelled"
  | "declined";

export type StepFields = {
  id: string;
  title: string;
  /** Where the step stands; a step without one shows no mark. */
  state?: StepState | undefined;
  /** Set once the step is cancelled, which shows as cancelled whatever its state. */
  cancelled?: object | undefined;
  /** Set once the person declined the step, which shows as declined whatever its state. */
  declined?: object | undefined;
  summary?: string | undefined;
  evidence?: readonly string[] | undefined;
  needs?: readonly string[] | undefined;
  /** The person may decline it. */
  optional?: boolean | undefined;
  /** Whether it waits for the person's go-ahead before it starts, always or only if they asked. */
  approval?: "required" | "optional" | undefined;
  /** When the step started, as a timestamp. */
  startedAt?: string | undefined;
};

export type StepItem = StepFields & {
  /** Set on a group: the steps it holds, which hold none. A group shows only its title and state. */
  steps?: readonly StepFields[] | undefined;
};

export type StepsProps = {
  steps: readonly StepItem[];
  /** Names the list. */
  label: string;
  /** The time now in milliseconds, which counts a running step's elapsed time; without it none shows. */
  now?: number | undefined;
  /** A quiet line under a step's title. */
  note?: ((step: StepFields) => string | undefined) | undefined;
  /** What the person can do with a step, under its row. */
  action?: ((step: StepFields) => ReactNode) | undefined;
};

const words: Record<StepState, string> = {
  done: "Done",
  failed: "Failed",
  running: "Running",
  needs_you: "Needs you",
  waiting: "Waiting",
  not_started: "Not started",
  skipped: "Skipped",
  cancelled: "Cancelled",
  declined: "Declined",
};

const tones: Record<StepState, string> = {
  done: styles.done,
  failed: styles.failed,
  running: styles.attention,
  needs_you: styles.attention,
  waiting: styles.quiet,
  not_started: styles.quiet,
  skipped: styles.quiet,
  cancelled: styles.quiet,
  declined: styles.quiet,
};

const marks: Record<StepState, ReactNode> = {
  done: <path d="M3 8.5l3.2 3L13 4.5" />,
  failed: <path d="M4 4l8 8M12 4l-8 8" />,
  running: <path d="M8 2a6 6 0 1 0 6 6" />,
  needs_you: <path d="M8 3v6M8 12v.5" />,
  waiting: <path d="M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3l2 1" />,
  not_started: <circle cx="8" cy="8" r="5.5" />,
  skipped: <path d="M3.5 8h9" />,
  cancelled: (
    <path d="M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM4.1 11.9l7.8-7.8" />
  ),
  declined: <path d="M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM5.5 8h5" />,
};

function StateMark({
  state,
  now,
  startedAt,
}: {
  state: StepState;
  now: number | undefined;
  startedAt: string | undefined;
}) {
  const started = startedAt === undefined ? Number.NaN : Date.parse(startedAt);
  const seconds =
    state === "running" && now !== undefined && !Number.isNaN(started)
      ? Math.max(0, Math.floor((now - started) / 1000))
      : null;
  return (
    <span className={`${styles.state} ${tones[state]}`}>
      <svg
        className={styles.icon}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {marks[state]}
      </svg>
      {words[state]}
      {seconds === null
        ? null
        : ` ${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`}
    </span>
  );
}

function Detail({
  title,
  lines,
}: {
  title: string;
  lines: readonly string[] | undefined;
}) {
  if (lines === undefined || lines.length === 0) return null;
  return (
    <div className={styles.detail}>
      <p className={styles.detailTitle}>{title}</p>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function stateOf(step: StepFields) {
  if (step.cancelled !== undefined) return "cancelled";
  if (step.declined !== undefined) return "declined";
  return step.state;
}

function Step({
  step,
  now,
  note,
  action,
  children,
}: {
  step: StepFields;
  now: number | undefined;
  note: StepsProps["note"];
  action: StepsProps["action"];
  children?: ReactNode;
}) {
  const state = stateOf(step);
  const line = note?.(step);
  const head = (
    <>
      <span className={styles.title}>
        {step.title}
        {line === undefined ? null : (
          <span className={styles.note}>{line}</span>
        )}
      </span>
      {state === undefined ? null : (
        <StateMark state={state} now={now} startedAt={step.startedAt} />
      )}
    </>
  );
  const opens =
    step.summary !== undefined ||
    (step.evidence?.length ?? 0) > 0 ||
    (step.needs?.length ?? 0) > 0;
  return (
    <li className={styles.step}>
      {opens ? (
        <details>
          <summary className={styles.row}>{head}</summary>
          {step.summary === undefined ? null : (
            <p className={styles.summary}>{step.summary}</p>
          )}
          <Detail title="Evidence" lines={step.evidence} />
          <Detail title="Needs" lines={step.needs} />
        </details>
      ) : (
        <div className={styles.row}>{head}</div>
      )}
      {action?.(step)}
      {children}
    </li>
  );
}

export function Steps({ steps, label, now, note, action }: StepsProps) {
  return (
    <ol className={styles.steps} aria-label={label}>
      {steps.map((step) => (
        <Step
          key={step.id}
          step={
            step.steps === undefined
              ? step
              : { id: step.id, title: step.title, state: step.state }
          }
          now={now}
          note={step.steps === undefined ? note : undefined}
          action={step.steps === undefined ? action : undefined}
        >
          {step.steps === undefined || step.steps.length === 0 ? null : (
            <ol className={styles.children}>
              {step.steps.map((child) => (
                <Step
                  key={child.id}
                  step={child}
                  now={now}
                  note={note}
                  action={action}
                />
              ))}
            </ol>
          )}
        </Step>
      ))}
    </ol>
  );
}

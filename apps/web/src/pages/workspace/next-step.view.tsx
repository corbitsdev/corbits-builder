import { Button, StatusDot } from "@corbits/react-ui";
import styles from "./next-step.module.css";

export type NextStepLineViewProps = {
  /** Someone is at work right now, so the dot moves. */
  busy: boolean;
  /** Who works now. */
  now: string;
  /** The person's next step. */
  next: string;
  /** The step's own control, when the workspace has one for it. */
  action: { label: string; onSelect: () => void } | null;
};

/** One line: who works now and the next step, with the step's own control when it has one. */
export function NextStepLineView({
  busy,
  now,
  next,
  action,
}: NextStepLineViewProps) {
  return (
    <div className={styles.line} role="status">
      <StatusDot
        label=""
        size="xs"
        live={busy}
        tone={busy ? "emphasis" : "neutral"}
      />
      <p className={styles.text} title={`${now} ${next}`}>
        <span className={styles.now}>{now}</span> <strong>{next}</strong>
      </p>
      {action === null ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={action.onSelect}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

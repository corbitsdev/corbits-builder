import { useEffect, useState } from "react";
import { Button as UiButton } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { SECONDS, type TypedYes } from "./approval-reply.ts";
import styles from "./typed-yes.module.css";

const text = wording.approval.typedYes;

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

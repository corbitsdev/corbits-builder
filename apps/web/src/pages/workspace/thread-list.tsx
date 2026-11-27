/**
 * Several of the agents' items in a row, gathered under one line that counts them, so a busy stretch
 * of the conversation reads as one list rather than a stack of rows. Hidden, the rows stay mounted
 * and keep their place.
 */
import { useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import styles from "./thread-list.module.css";

export function ThreadList({
  label,
  busy = false,
  startHidden = false,
  children,
}: {
  /** The line over the list, counting what it holds: "2 things in progress". */
  label: string;
  /** What the list holds is still at work. */
  busy?: boolean;
  /** Opens folded, for a run too long to keep in view. */
  startHidden?: boolean;
  children: ReactNode;
}) {
  const [hidden, setHidden] = useState(startHidden);
  return (
    <section className={styles.list} aria-label={label} data-slot="thread-list">
      <div className={styles.head}>
        {busy ? <LoaderCircle className={styles.spinner} aria-hidden /> : null}
        <span className={styles.label}>{label}</span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className={styles.toggle}
          aria-expanded={!hidden}
          onClick={() => setHidden(!hidden)}
        >
          {hidden ? wording.threadList.show : wording.threadList.hide}
        </Button>
      </div>
      <div
        className={styles.items}
        data-slot="thread-list-items"
        hidden={hidden}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * The two states every question the person answers in the conversation takes, so screens and
 * question cards read as one family. Open, the ask heads a framed card over the view's own body and
 * its row of actions; settled, the same place keeps one quiet line of what was asked and what was
 * answered.
 */
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { GateBlock } from "@corbits/react-ui";
import styles from "./screen-card.module.css";

export function ScreenCard({
  title,
  actions,
  className,
  children,
}: {
  /** The ask, as the card's heading. */
  title: string;
  /** The card's `ScreenActions`; a view whose keys must reach its actions puts them in its body. */
  actions?: ReactNode;
  /** For a view that places something of its own against the card's frame. */
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <GateBlock
      className={
        className === undefined ? styles.card : `${styles.card} ${className}`
      }
      gate={{ kind: "form", title }}
      footer={actions}
    >
      <div className={styles.body}>{children}</div>
    </GateBlock>
  );
}

/** An answered question: what was asked, then what was answered. */
export function ScreenSettled({
  asked,
  answer,
}: {
  asked: string;
  answer: string;
}) {
  return (
    <p className={styles.settled} data-slot="screen-settled">
      <Check className={styles.mark} aria-hidden />
      <span>
        <span className={styles.asked}>{asked}</span>{" "}
        <span className={styles.answer}>{answer}</span>
      </span>
    </p>
  );
}

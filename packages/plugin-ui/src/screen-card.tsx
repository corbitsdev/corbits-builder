/**
 * The states every question the person answers in the conversation takes, so screens and question
 * cards read as one family. Open, the ask heads a framed card over the view's own body and its row
 * of actions; settled, a quieter frame of the same width says how it ended, then what was asked and
 * what was answered.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Check, CircleHelp, CirclePause } from "lucide-react";
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

/**
 * A question that takes no more answers, or one this interface cannot draw: a heading that says
 * which, then what was asked and answered.
 */
export function SettledFrame({
  title,
  ended,
  focus,
  children,
}: {
  title: string;
  ended: "answered" | "closed" | "waiting";
  /**
   * The person answered from the card this replaces, so focus, which went with the card, comes
   * here rather than to the page's start.
   */
  focus?: boolean;
  children: ReactNode;
}) {
  const frame = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus === true && document.activeElement === document.body)
      frame.current?.focus();
  }, [focus]);
  return (
    <section
      ref={frame}
      tabIndex={-1}
      className={styles.settled}
      aria-label={title}
      data-slot="question-settled"
    >
      <p className={styles.settledTitle}>
        {ended === "answered" ? (
          <Check className={styles.settledMark} data-ok="" aria-hidden />
        ) : null}
        {ended === "closed" ? (
          <CirclePause className={styles.settledMark} aria-hidden />
        ) : null}
        {ended === "waiting" ? (
          <CircleHelp className={styles.settledMark} aria-hidden />
        ) : null}
        {title}
      </p>
      <div className={styles.settledBody}>{children}</div>
    </section>
  );
}

/** Each thing asked with its answer; an answer that is an absence is muted so it never reads as one. */
export function SettledAnswers({
  answers,
}: {
  answers: readonly { asked: string; answer: string; absent?: boolean }[];
}) {
  return (
    <dl className={styles.answers}>
      {answers.map(({ asked, answer, absent }, index) => (
        <div key={index}>
          <dt>{asked}</dt>
          <dd data-absent={absent === true ? "" : undefined}>{answer}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An answered screen, inside the frame its host draws: what was asked, then what was chosen. */
export function ScreenSettled({
  asked,
  answer,
}: {
  asked: string;
  answer: string;
}) {
  return <SettledAnswers answers={[{ asked, answer }]} />;
}

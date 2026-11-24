/**
 * The prompt box's cards for what waits on the person where nothing else draws one: a step held for
 * their go-ahead, and a plugin's screen waiting in the plugin space. Each heads the box with what it
 * asks; its one forward action stands where Send does.
 */
import { useContext } from "react";
import { Button } from "@corbits/react-ui";
import {
  ActionsSlot,
  usePromptPlaceholder,
} from "@corbits-builder/plugin-ui/screen-actions";
import { wording } from "../../config.ts";
import styles from "./box-cards.module.css";

const text = wording.promptBox.waiting;

/** A step the person asked to be consulted on: Yes, go ahead stands where Send is. */
export function StepCard({
  title,
  busy,
  onGoAhead,
}: {
  title: string;
  /** The go-ahead is on its way, so the card holds until it lands. */
  busy: boolean;
  onGoAhead: () => void;
}) {
  const slot = useContext(ActionsSlot);
  usePromptPlaceholder(text.stepPlaceholder);
  const ask = text.step(title);
  const yes = (
    <div className={styles.answers} inert={busy}>
      <Button type="button" size="sm" onClick={onGoAhead}>
        {text.goAhead}
      </Button>
    </div>
  );
  return (
    <section
      className={styles.card}
      aria-label={ask}
      data-slot="box-card"
      data-kind="step"
    >
      <p className={styles.ask}>{ask}</p>
      <p className={styles.detail}>{text.stepDetail}</p>
      {slot === null ? yes : slot(yes)}
    </section>
  );
}

/**
 * A plugin's screen waiting in the plugin space: Open takes the person to it, and Not now turns
 * down one the coordinator asked with, or sets aside one a plugin showed of its own accord. The
 * screen's own forward action reaches the box from the space.
 */
export function ScreenCard({
  title,
  onOpen,
  onNotNow,
  disabled = false,
}: {
  title: string;
  /** Opens the space; absent while the screen is already in sight. */
  onOpen?: (() => void) | undefined;
  /** Turns the screen down, or sets it aside for now. */
  onNotNow?: (() => void) | undefined;
  disabled?: boolean;
}) {
  const ask = text.screen(title);
  return (
    <section
      className={styles.card}
      aria-label={ask}
      data-slot="box-card"
      data-kind="screen"
    >
      <header className={styles.head}>
        <p className={styles.ask}>{ask}</p>
        {onNotNow === undefined ? null : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={styles.notNow}
            disabled={disabled}
            onClick={onNotNow}
          >
            {text.notNow}
          </Button>
        )}
        {onOpen === undefined ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={styles.open}
            onClick={onOpen}
          >
            {text.openScreen}
          </Button>
        )}
      </header>
    </section>
  );
}

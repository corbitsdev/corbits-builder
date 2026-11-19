/**
 * A few unordered choices side by side as segments, the interface's default way to choose; choices
 * too long for that as rows; and the radio group other choice controls are built on.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import styles from "./choice-segments.module.css";

export type Choice = { readonly id: string; readonly label: string };

export type ChoiceProps<Option extends Choice> = {
  /** Given to the chosen option, so a label or a jump to the choice reaches it. */
  id?: string;
  /** Names the set for assistive tech. */
  label: string;
  options: readonly Option[];
  /** The id of the option chosen. */
  choice: string;
  onChoose: (id: string) => void;
  disabled?: boolean;
};

const ARROW_STEP: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** The chosen option's place, or the first when the choice is not one of them. */
export function chosenIndex(
  options: readonly Choice[],
  choice: string,
): number {
  return Math.max(
    0,
    options.findIndex((option) => option.id === choice),
  );
}

/**
 * Options as a radio group: one tab stop, on the chosen option, and arrow keys move the choice. A
 * null choice means the person has chosen nothing yet: nothing is checked, the tab stop is on the
 * first option, and an arrow key or a press chooses, as in a native radio group.
 */
export function RadioGroup<Option extends Choice>({
  id,
  label,
  options,
  choice,
  onChoose,
  disabled = false,
  look,
  children,
}: Omit<ChoiceProps<Option>, "choice"> & {
  choice: string | null;
  look: { slot: string; group: string; option: string };
  children: (option: Option) => ReactNode;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = choice === null ? -1 : chosenIndex(options, choice);
  const stop = Math.max(0, chosen);
  const move = (event: KeyboardEvent, index: number) => {
    const step = ARROW_STEP[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChoose(options[next]!.id);
    buttons.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={look.group}
      data-slot={look.slot}
    >
      {options.map((option, index) => (
        <button
          key={option.id}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          id={index === stop ? id : undefined}
          type="button"
          role="radio"
          aria-label={option.label}
          aria-checked={index === chosen}
          tabIndex={index === stop ? 0 : -1}
          disabled={disabled}
          className={look.option}
          onClick={() => onChoose(option.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {children(option)}
        </button>
      ))}
    </div>
  );
}

/** A label as wide as it is in bold, so turning bold when chosen moves nothing beside it. */
export function BoldWidth({ children }: { children: string }) {
  return (
    <span className={styles.boldWidth} data-label={children}>
      {children}
    </span>
  );
}

const SEGMENTS = {
  slot: "choice-segments",
  group: styles.segments,
  option: styles.segment,
};

/** A few unordered choices side by side; the default way to choose. */
export function ChoiceSegments(props: ChoiceProps<Choice>) {
  return (
    <RadioGroup {...props} look={SEGMENTS}>
      {(option) => <BoldWidth>{option.label}</BoldWidth>}
    </RadioGroup>
  );
}

const ROWS = {
  slot: "choice-rows",
  group: styles.rows,
  option: styles.row,
};

/**
 * Choices too long to sit side by side, such as plans or prices, as rows the whole width of the
 * set. Nothing is chosen while choice is null, so a list where the person must pick does not pick
 * for them.
 */
export function ChoiceRows(
  props: Omit<ChoiceProps<Choice>, "choice"> & { choice: string | null },
) {
  return (
    <RadioGroup {...props} look={ROWS}>
      {(option) => <span className={styles.rowLabel}>{option.label}</span>}
    </RadioGroup>
  );
}

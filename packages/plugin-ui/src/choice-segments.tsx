/**
 * A few unordered choices side by side as segments, the interface's default way to choose, and the
 * radio group other choice controls are built on.
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

/** Options as radios: one tab stop on the chosen one, and arrow keys that move the choice. */
export function RadioGroup<Option extends Choice>({
  id,
  label,
  options,
  choice,
  onChoose,
  disabled = false,
  look,
  children,
}: ChoiceProps<Option> & {
  look: { slot: string; group: string; option: string };
  children: (option: Option) => ReactNode;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = chosenIndex(options, choice);
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
          id={index === chosen ? id : undefined}
          type="button"
          role="radio"
          aria-label={option.label}
          aria-checked={index === chosen}
          tabIndex={index === chosen ? 0 : -1}
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

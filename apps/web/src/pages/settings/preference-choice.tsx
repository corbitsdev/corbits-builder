/**
 * The controls a preference is chosen with: segments by default, a scale where the choices have an
 * order, and pictures where the result is something to look at.
 */
import type { ThemeMode } from "@corbits/react-ui";
import { clsx } from "clsx";
import {
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import styles from "./preference-choice.module.css";

export type Choice = { readonly id: string; readonly label: string };

type ChoiceProps<Option extends Choice> = {
  /** Given to the chosen option, so a label or a jump to the preference reaches it. */
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
function chosenIndex(options: readonly Choice[], choice: string): number {
  return Math.max(
    0,
    options.findIndex((option) => option.id === choice),
  );
}

/** Options as radios: one tab stop on the chosen one, and arrow keys that move the choice. */
function RadioGroup<Option extends Choice>({
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
function BoldWidth({ children }: { children: string }) {
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

/** Choices with an order, as stops on a scale between two ends. */
export function ChoiceScale({
  id,
  label,
  options,
  choice,
  onChoose,
  disabled = false,
  ends,
}: ChoiceProps<Choice> & {
  ends: { readonly start: string; readonly end: string };
}) {
  const chosen = chosenIndex(options, choice);
  // Each stop's place along the rail, from 0 to 1.
  const at = (index: number) => index / Math.max(1, options.length - 1);
  return (
    <div className={styles.scale} data-slot="choice-scale">
      <div className={styles.ends} aria-hidden="true">
        <span>{ends.start}</span>
        <span>{ends.end}</span>
      </div>
      <div
        className={styles.track}
        style={{ "--at": at(chosen) } as CSSProperties}
      >
        {options.map((option, index) => (
          <span
            key={option.id}
            className={styles.stop}
            style={{ "--stop": at(index) } as CSSProperties}
            data-reached={index <= chosen ? "" : undefined}
          />
        ))}
        <input
          id={id}
          type="range"
          min={0}
          max={options.length - 1}
          step={1}
          value={chosen}
          aria-label={label}
          aria-valuetext={options[chosen]?.label}
          disabled={disabled}
          onChange={(event) =>
            onChoose(options[Number(event.target.value)]!.id)
          }
        />
      </div>
      <div className={styles.stops} aria-hidden="true">
        {options.map((option, index) => (
          <span key={option.id} data-chosen={index === chosen ? "" : undefined}>
            <BoldWidth>{option.label}</BoldWidth>
          </span>
        ))}
      </div>
    </div>
  );
}

const PICTURES = {
  slot: "picture-choice",
  group: styles.pictures,
  option: styles.pictureOption,
};

/** Choices shown as pictures of their result, each captioned with its name. */
export function PictureChoice(
  props: ChoiceProps<Choice & { readonly picture: ReactNode }>,
) {
  return (
    <RadioGroup {...props} look={PICTURES}>
      {(option) => (
        <>
          <span className={styles.picture}>{option.picture}</span>
          <span className={styles.caption}>
            <span className={styles.radio} />
            {option.label}
          </span>
        </>
      )}
    </RadioGroup>
  );
}

/** A small page drawn in a theme; System is a light page with a dark right half. */
export function ThemePicture({ mode }: { mode: ThemeMode }) {
  return (
    <>
      <ThemePage dark={mode === "dark"} />
      {mode === "system" ? <ThemePage dark half /> : null}
    </>
  );
}

function ThemePage({ dark, half = false }: { dark: boolean; half?: boolean }) {
  return (
    <span
      className={clsx(styles.page, dark && "dark")}
      data-half={half ? "" : undefined}
    >
      {/* A title bar, then three lines of text. */}
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

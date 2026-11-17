/**
 * The controls a preference is chosen with besides the default segments: a scale where the choices
 * have an order, and pictures where the result is something to look at.
 */
import type { ThemeMode } from "@corbits/react-ui";
import {
  BoldWidth,
  RadioGroup,
  chosenIndex,
  type Choice,
  type ChoiceProps,
} from "@corbits-builder/plugin-ui/choice-segments";
import { clsx } from "clsx";
import type { CSSProperties, ReactNode } from "react";
import styles from "./preference-choice.module.css";

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

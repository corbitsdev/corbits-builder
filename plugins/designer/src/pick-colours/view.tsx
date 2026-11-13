/**
 * The colour picker as the conversation draws it. Each colour in use is its own control: the swatch
 * opens the system's colour input and the field beside it takes a value typed or pasted. A proposed
 * colour is one press beside it. The main action keeps the colours until one differs, then changes
 * them. Settles to one line once answered.
 */
import { useId } from "react";
import { Button, Input } from "@corbits/react-ui";
import type { ScreenViewProps } from "@corbits-builder/plugin";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import { Color, type Input as ScreenInput, type Output } from "./schema.ts";
import styles from "./view.module.css";

type Side = "primary" | "background";
type Pair = Record<Side, string | undefined>;
type Answer = typeof Output.infer;

export type Prepared = { current: Pair; proposed: Pair };

type Props = ScreenViewProps<typeof ScreenInput.infer, Answer, Prepared>;

export const text = {
  title: "Choose your colours",
  sides: { primary: "Primary", background: "Background" } satisfies Record<
    Side,
    string
  >,
  about:
    "Primary is the brand colour of buttons and links; background is the page behind everything.",
  pick: (side: string) => `Pick the ${side.toLowerCase()} colour`,
  was: (value: string) => `was ${value}`,
  useProposed: (value: string) => `Use the proposed ${value}`,
  missing: "Choose both colours to save.",
  format: 'Write each colour as # and six hex digits, such as "#1d4ed8".',
  keep: "Keep my colours",
  change: "Change my colours",
  reset: "Reset",
  saving: "Saving…",
  asked: "Which colours?",
  kept: "Kept as they were",
  settled: (primary: string, background: string) =>
    `Primary ${primary}, background ${background}`,
};

const sides: readonly Side[] = ["primary", "background"];

const differs = (a: string | undefined, b: string | undefined) =>
  a?.toLowerCase() !== b?.toLowerCase();

/**
 * What the main action says and sends for the colours as they stand: the colours in use until the
 * person changes one, and nothing to send while a colour is missing or not in the accepted format.
 */
export function choice(prepared: Prepared, draft: Partial<Answer>) {
  const value = (of: Side) => draft[of] ?? prepared.current[of];
  const changed = sides.some((of) => differs(value(of), prepared.current[of]));
  const label = changed ? text.change : text.keep;
  const primary = value("primary");
  const background = value("background");
  if (primary === undefined || background === undefined)
    return { changed, label, hint: text.missing };
  if (!Color.allows(primary) || !Color.allows(background))
    return { changed, label, hint: text.format };
  return { changed, label, answer: { primary, background } };
}

function Swatch({ color }: { color: string }) {
  return (
    <span className={styles.swatch} style={{ background: color }} aria-hidden />
  );
}

export function ColourPicker({
  prepared,
  draft,
  setDraft,
  submit,
  submitting,
  answer,
}: Props) {
  const id = useId();
  if (answer !== undefined)
    return (
      <ScreenSettled
        asked={text.asked}
        answer={
          sides.some((of) => differs(answer[of], prepared.current[of]))
            ? text.settled(answer.primary, answer.background)
            : text.kept
        }
      />
    );
  const value = (of: Side) => draft[of] ?? prepared.current[of];
  const chosen = choice(prepared, draft);
  // A side with no colour in use has nothing to go back to.
  const resettable = sides.filter(
    (of) =>
      prepared.current[of] !== undefined &&
      differs(value(of), prepared.current[of]),
  );
  const set = (of: Side, color: string) =>
    setDraft(of === "primary" ? { primary: color } : { background: color });
  return (
    <ScreenCard
      title={text.title}
      actions={
        <ScreenActions note={chosen.hint}>
          <Button
            type="button"
            size="sm"
            disabled={submitting || chosen.answer === undefined}
            onClick={() => {
              if (chosen.answer !== undefined) void submit(chosen.answer);
            }}
          >
            {submitting ? text.saving : chosen.label}
          </Button>
          {resettable.length === 0 ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                for (const of of resettable) {
                  const current = prepared.current[of];
                  if (current !== undefined) set(of, current);
                }
              }}
            >
              {text.reset}
            </Button>
          )}
        </ScreenActions>
      }
    >
      <div className={styles.picker}>
        <p className={styles.note}>{text.about}</p>
        {sides.map((of) => {
          const shown = value(of) ?? "";
          const current = prepared.current[of];
          const proposed = prepared.proposed[of];
          const offer =
            proposed !== undefined && differs(proposed, current)
              ? proposed
              : undefined;
          return (
            <div key={of} className={styles.row}>
              {/* The system's colour input is the swatch itself; it shows only a colour it accepts. */}
              <input
                type="color"
                className={styles.well}
                aria-label={text.pick(text.sides[of])}
                value={Color.allows(shown) ? shown.toLowerCase() : "#000000"}
                disabled={submitting}
                onChange={(event) => set(of, event.target.value)}
              />
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${id}-${of}`}>
                  {text.sides[of]}
                  {current !== undefined && differs(shown, current) ? (
                    <span className={styles.was}>{text.was(current)}</span>
                  ) : null}
                </label>
                <Input
                  id={`${id}-${of}`}
                  className={styles.value}
                  value={shown}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={shown !== "" && !Color.allows(shown)}
                  disabled={submitting}
                  onChange={(event) => set(of, event.target.value.trim())}
                />
              </div>
              {offer === undefined ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={styles.proposed}
                  aria-pressed={!differs(shown, offer)}
                  disabled={submitting}
                  onClick={() => set(of, offer)}
                >
                  <Swatch color={offer} />
                  {text.useProposed(offer)}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </ScreenCard>
  );
}

export default ColourPicker;

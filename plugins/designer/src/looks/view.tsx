/**
 * How many looks the person wants to compare, as one card in the conversation: three choices with
 * their current setting chosen, and one button to go on with it. Settles to one line once answered.
 */
import { useId } from "react";
import { Button } from "@corbits/react-ui";
import type { ScreenViewProps } from "@corbits-builder/plugin";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import type { Input, Output } from "./schema.ts";
import styles from "./view.module.css";

type Looks = (typeof Output.infer)["looks"];
type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  typeof Input.infer
>;

const LOOKS: readonly Looks[] = ["one", "two", "three"];

export const text = {
  ask: "How many looks do you want to compare?",
  label: { one: "One", two: "Two", three: "Three" } satisfies Record<
    Looks,
    string
  >,
  go: (looks: Looks) =>
    looks === "one" ? "Make one look" : `Compare ${looks} looks`,
  orWrite: "Or write below what you have in mind.",
  settled: (looks: Looks) => `Looks to compare: ${text.label[looks]}`,
};

// The setting the person has now, when it is one the card offers; a larger one offers the most.
const offered = (
  current: (typeof Input.infer)["current"],
): Looks | undefined =>
  current === "four" || current === "five" ? "three" : current;

export function ChooseLooks({
  input,
  draft,
  setDraft,
  submit,
  submitting,
  answer,
}: Props) {
  const askId = useId();
  if (answer !== undefined)
    return <p className={styles.settled}>{text.settled(answer.looks)}</p>;
  const chosen = draft.looks ?? offered(input.current);
  return (
    <section
      className={styles.card}
      aria-labelledby={askId}
      data-slot="choose-looks"
    >
      <p id={askId} className={styles.question}>
        {text.ask}
      </p>
      <div className={styles.choices} role="group" aria-labelledby={askId}>
        {LOOKS.map((looks) => (
          <Button
            key={looks}
            type="button"
            size="sm"
            variant={looks === chosen ? "secondary" : "outline"}
            aria-pressed={looks === chosen}
            disabled={submitting}
            onClick={() => setDraft({ looks })}
          >
            {text.label[looks]}
          </Button>
        ))}
      </div>
      <ScreenActions note={text.orWrite}>
        {chosen === undefined ? null : (
          <Button
            type="button"
            size="sm"
            disabled={submitting}
            onClick={() => void submit({ looks: chosen })}
          >
            {text.go(chosen)}
          </Button>
        )}
      </ScreenActions>
    </section>
  );
}

export default ChooseLooks;

/**
 * How many looks the person wants to compare, as one card in the conversation: three choices with
 * their current setting chosen, and one button to go on with it. Settles to one line once answered.
 */
import { Button } from "@corbits/react-ui";
import type { ScreenViewProps } from "@corbits-builder/plugin";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import { LOOKS_LABEL, type Input, type Output } from "./schema.ts";
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
  label: LOOKS_LABEL,
  go: (looks: Looks) =>
    looks === "one" ? "Make one look" : `Compare ${looks} looks`,
  orWrite: "Or write below what you have in mind.",
  asked: "How many looks?",
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
  if (answer !== undefined)
    return (
      <ScreenSettled asked={text.asked} answer={text.label[answer.looks]} />
    );
  const chosen = draft.looks ?? offered(input.current);
  return (
    <ScreenCard
      title={text.ask}
      actions={
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
      }
    >
      <div
        className={styles.choices}
        role="group"
        aria-label={text.ask}
        data-slot="choose-looks"
      >
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
    </ScreenCard>
  );
}

export default ChooseLooks;

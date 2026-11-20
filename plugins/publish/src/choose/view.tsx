/**
 * Asks where the app should be published. It lists the installed publish plans as their manifests
 * describe them, and the answer is the handle of the plan picked.
 */
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { ChoiceRows } from "@corbits-builder/plugin-ui/choice-segments";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import { Button } from "@corbits/react-ui";
import choose, { text } from "./definition.ts";
import type { Input, Output } from "./schema.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  ReturnType<NonNullable<typeof choose.fromProject>>
>;

export function ChoosePlan({
  prepared: { data: options },
  draft,
  setDraft,
  submit,
  submitting,
  answer,
}: Props) {
  if (answer !== undefined)
    return (
      <ScreenSettled
        asked={text.title}
        answer={
          options.find((option) => option.id === answer.plan)?.label ??
          answer.plan
        }
      />
    );
  if (options.length === 0)
    return (
      <ScreenCard title={text.title}>
        <p className={styles.none}>{text.none}</p>
      </ScreenCard>
    );
  // Nothing is chosen until the person picks, unless only one plan is offered.
  const only = options.length === 1 ? options[0]!.id : null;
  const chosen = options.find((option) => option.id === draft.plan)?.id ?? only;
  return (
    <ScreenCard
      title={text.title}
      actions={
        <ScreenActions note={text.orWrite}>
          <Button
            type="button"
            size="sm"
            disabled={submitting || chosen === null}
            onClick={() => {
              if (chosen !== null) void submit({ plan: chosen });
            }}
          >
            {text.choose}
          </Button>
        </ScreenActions>
      }
    >
      <ChoiceRows
        label={text.plans}
        options={options}
        choice={chosen}
        onChoose={(plan) => setDraft({ plan })}
        disabled={submitting}
      />
    </ScreenCard>
  );
}

export default ChoosePlan;

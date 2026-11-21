/**
 * Puts a change of direction to the person: the plan steps that stop and what happens instead, with
 * one button to change direction and one to keep the plan. Settles to one line once answered.
 */
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import { Button } from "@corbits/react-ui";
import changeDirection, { text } from "./definition.ts";
import type { Input, Output } from "./schema.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  ReturnType<NonNullable<typeof changeDirection.fromProject>>
>;

export function ChangeDirection({
  prepared: { data },
  submit,
  submitting,
  answer,
}: Props) {
  if (answer !== undefined)
    return (
      <ScreenSettled
        asked={text.title}
        answer={answer.agreed === null ? text.keep : text.go}
      />
    );
  const { stops, instead } = data;
  return (
    <ScreenCard
      title={text.title}
      actions={
        <ScreenActions note={text.orWrite}>
          <Button
            type="button"
            size="sm"
            disabled={submitting || stops.length === 0}
            onClick={() => void submit({ agreed: stops.map(({ id }) => id) })}
          >
            {text.go}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={() => void submit({ agreed: null })}
          >
            {text.keep}
          </Button>
        </ScreenActions>
      }
    >
      {stops.length === 0 ? (
        <p className={styles.line} data-slot="change-direction">
          {text.nothing}
        </p>
      ) : (
        <div data-slot="change-direction">
          <p className={styles.line}>{text.stops}</p>
          <ul className={styles.steps}>
            {stops.map(({ id, title }) => (
              <li key={id}>{title}</li>
            ))}
          </ul>
          <p className={styles.line}>
            {text.instead} {instead}
          </p>
        </div>
      )}
    </ScreenCard>
  );
}

export default ChangeDirection;

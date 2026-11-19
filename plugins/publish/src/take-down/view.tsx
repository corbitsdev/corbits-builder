/**
 * Asks whether to take the app down, before anything is removed. It shows, in the removal action's
 * words, what goes and what happens to what people entered, with the app's address and what is held
 * there that costs money. The answer is the person's go-ahead for exactly what they were shown, or
 * that they keep the app.
 */
import { PUBLISH_GROUP } from "@corbits-builder/plugin/publish";
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import { Button } from "@corbits/react-ui";
import { takenDown, type Host } from "../plans.ts";
import { text } from "./definition.ts";
import type { Input, Output } from "./schema.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  {
    plan: string;
    release: { target: string; url: string; at: string } | null;
    holding: {
      target: string;
      place: string;
      since: string;
      costs?: string;
    } | null;
  },
  Host
>;

export function TakeDown({
  prepared: { data, resources },
  submit,
  submitting,
  answer,
}: Props) {
  const { plan, release, holding } = data;
  const offered = resources
    .readyPlans(PUBLISH_GROUP)
    .find((candidate) => candidate.handle === plan);
  if (answer !== undefined)
    return (
      <ScreenSettled
        asked={text.title}
        answer={answer.agreed === null ? text.kept : text.agreed}
      />
    );
  const shown = takenDown(offered, release, holding);
  const removes = offered?.takeDown?.removes;
  return (
    <ScreenCard
      title={text.title}
      actions={
        <ScreenActions note={text.orWrite}>
          <Button
            type="button"
            size="sm"
            disabled={submitting || shown === null}
            onClick={() => {
              if (shown !== null) void submit({ agreed: shown.agreed });
            }}
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
      <ul className={styles.points} data-slot="publish-take-down">
        {shown === null ? (
          <li>{text.nothing}</li>
        ) : (
          <>
            {removes === undefined ? null : <li>{removes.what}</li>}
            {shown.url === undefined ? null : (
              <li>
                {text.address}{" "}
                <a
                  className={styles.address}
                  href={shown.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shown.url}
                </a>
              </li>
            )}
            {shown.held === undefined ? null : (
              <li>
                {shown.held.costs === undefined
                  ? text.held(shown.held.place)
                  : text.costs(shown.held.place, shown.held.costs)}
              </li>
            )}
            {removes === undefined ? null : <li>{removes.entered}</li>}
          </>
        )}
      </ul>
    </ScreenCard>
  );
}

export default TakeDown;

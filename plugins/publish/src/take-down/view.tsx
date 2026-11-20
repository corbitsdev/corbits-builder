/**
 * Asks whether to take the app down, before anything is removed. The answer is the person's
 * go-ahead for exactly what they were shown, or that they keep the app.
 */
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import { Button } from "@corbits/react-ui";
import { Address, Points } from "../points.tsx";
import takeDown, { text } from "./definition.ts";
import type { Input, Output } from "./schema.ts";

type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  ReturnType<NonNullable<typeof takeDown.fromProject>>
>;

export function TakeDown({
  prepared: { data },
  submit,
  submitting,
  answer,
}: Props) {
  const { shown, removes } = data;
  if (answer !== undefined)
    return (
      <ScreenSettled
        asked={text.title}
        answer={answer.agreed === null ? text.keep : text.go}
      />
    );
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
      <Points slot="publish-take-down">
        {shown === null ? (
          <li>{text.nothing}</li>
        ) : (
          <>
            {removes === undefined ? null : <li>{removes.what}</li>}
            {shown.url === undefined ? null : (
              <li>
                {text.address} <Address url={shown.url} />
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
      </Points>
    </ScreenCard>
  );
}

export default TakeDown;

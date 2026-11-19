// Asks for the person's go-ahead to publish, showing only what they need to decide.
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import { Button } from "@corbits/react-ui";
import { Address, Points } from "../points.tsx";
import confirm, { text } from "./definition.ts";
import type { Input, Output } from "./schema.ts";

type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  ReturnType<NonNullable<typeof confirm.fromProject>>
>;

export function ConfirmPublish({
  prepared: { data },
  submit,
  submitting,
  answer,
}: Props) {
  const { plan, url, changes, firstRun } = data;
  // An answered go-ahead reads the same whatever was published since.
  if (answer !== undefined)
    return <ScreenSettled asked={text.title(false)} answer={text.go(false)} />;
  return (
    <ScreenCard
      title={text.title(changes)}
      actions={
        <ScreenActions note={text.orWrite}>
          <Button
            type="button"
            size="sm"
            disabled={submitting}
            onClick={() => void submit({ go: true, plan })}
          >
            {text.go(changes)}
          </Button>
        </ScreenActions>
      }
    >
      <Points slot="publish-confirm">
        {changes && url !== undefined ? (
          <li>
            {text.replaces.before}
            <Address url={url} />
            {text.replaces.after}
          </li>
        ) : (
          <>
            {firstRun === undefined ? null : <li>{firstRun}</li>}
            {url === undefined ? null : (
              <li>
                {text.elsewhere.before}
                <Address url={url} />
                {text.elsewhere.after}
              </li>
            )}
            <li>{text.anyone}</li>
          </>
        )}
      </Points>
    </ScreenCard>
  );
}

export default ConfirmPublish;

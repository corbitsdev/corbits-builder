/**
 * Asks for the person's go-ahead to publish, showing only what they need to decide. A first publish
 * says where the app goes, in the chosen plan's words, and who can open it. A publish of changes
 * says that the current address will show the version saved last.
 */
import { PUBLISH_GROUP } from "@corbits-builder/plugin/publish";
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import {
  ScreenCard,
  ScreenSettled,
} from "@corbits-builder/plugin-ui/screen-card";
import { Button } from "@corbits/react-ui";
import { replacesRelease, type Host } from "../plans.ts";
import { text } from "./definition.ts";
import type { Input, Output } from "./schema.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  typeof Input.infer,
  typeof Output.infer,
  {
    plan: string;
    release: { target: string; url: string; updatable: boolean } | null;
  },
  Host
>;

function Address({ url }: { url: string }) {
  return (
    <a className={styles.address} href={url} target="_blank" rel="noreferrer">
      {url}
    </a>
  );
}

export function ConfirmPublish({
  prepared: { data, resources },
  submit,
  submitting,
  answer,
}: Props) {
  const { plan, release } = data;
  const offered = resources
    .readyPlans(PUBLISH_GROUP)
    .find((candidate) => candidate.handle === plan);
  const changes = replacesRelease(release, offered);
  if (answer !== undefined)
    return (
      <ScreenSettled asked={text.title(changes)} answer={text.go(changes)} />
    );
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
      <ul className={styles.points} data-slot="publish-confirm">
        {changes && release !== null ? (
          <li>
            {text.replaces.before}
            <Address url={release.url} />
            {text.replaces.after}
          </li>
        ) : (
          <>
            {offered?.firstPublish === undefined ? null : (
              <li>{offered.firstPublish}</li>
            )}
            {release === null ? null : (
              <li>
                {text.elsewhere.before}
                <Address url={release.url} />
                {text.elsewhere.after}
              </li>
            )}
            <li>{text.anyone}</li>
          </>
        )}
      </ul>
    </ScreenCard>
  );
}

export default ConfirmPublish;

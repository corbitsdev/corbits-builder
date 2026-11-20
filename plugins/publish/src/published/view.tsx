/**
 * Where publishing the app stands, as the hub worked it out. The view only draws it; each button
 * runs one of the publish plugin's actions, and Take it down asks on the screen itself first.
 */
import { useState, type ReactNode } from "react";
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import { ScreenCard } from "@corbits-builder/plugin-ui/screen-card";
import { RadioGroup } from "@corbits-builder/plugin-ui/choice-segments";
import { Button } from "@corbits/react-ui";
import { text, type Shown, type Where } from "./definition.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  Record<string, never>,
  Record<string, never>,
  Shown
>;

export function Lines({ where }: { where: Where }) {
  const { release, holding, keep } = where;
  return (
    <div className={styles.lines} data-slot="publish-published">
      {release === undefined ? null : (
        <>
          <a
            className={styles.address}
            href={release.url}
            target="_blank"
            rel="noreferrer"
          >
            {release.url}
          </a>
          <span>{text.publishedAt(release.at)}</span>
          {release.replaceable ? null : <span>{text.newAddress}</span>}
        </>
      )}
      {holding === undefined ? null : (
        <span>{text.hosted(holding.place, holding.costs)}</span>
      )}
      {keep === undefined ? null : (
        <span>
          {keep.passed
            ? text.keep.passed(keep.place)
            : text.keep.lead(keep.place, keep.until)}
        </span>
      )}
    </div>
  );
}

/** Why the person's last click was refused, when it was. */
export function Fault({ fault }: { fault: string | undefined }) {
  return fault === undefined ? null : <p role="alert">{fault}</p>;
}

/** A button that runs one of the publish plugin's actions. */
export function Press({
  label,
  action,
  input = {},
  variant = "outline",
  act,
  submitting,
}: {
  label: string;
  action: string;
  input?: Record<string, unknown>;
  variant?: "primary" | "outline";
  act: Props["act"];
  submitting: boolean;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={submitting}
      onClick={() => void act?.(action, input)}
    >
      {label}
    </Button>
  );
}

/** Take your app down?, with what the place says goes and what is kept, and Yes, take it down. */
export function TakeDownSure({
  where,
  act,
  submitting,
  fault,
  keep,
}: {
  where: Where;
  act: Props["act"];
  submitting: boolean;
  fault: string | undefined;
  keep: ReactNode;
}) {
  return (
    <ScreenCard
      title={text.takeDown.sure}
      actions={
        <ScreenActions>
          <Press
            label={text.takeDown.yes}
            action="take-down"
            variant="primary"
            act={act}
            submitting={submitting}
          />
          {keep}
        </ScreenActions>
      }
    >
      <Fault fault={fault} />
      <p>{where.removes ?? text.takeDown.removes}</p>
      <Lines where={where} />
      {where.holding?.costs === undefined ? null : (
        <p>{text.takeDown.costs(where.holding.place, where.holding.costs)}</p>
      )}
    </ScreenCard>
  );
}

export function Published({
  prepared: { data },
  act,
  submitting,
  fault,
}: Props) {
  const [sure, setSure] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const press = (
    label: string,
    action: string,
    input: Record<string, unknown> = {},
    variant: "primary" | "outline" = "outline",
  ) => (
    <Press
      label={label}
      action={action}
      input={input}
      variant={variant}
      act={act}
      submitting={submitting}
    />
  );
  if (data.is === "publishing")
    return (
      <ScreenCard title={text.title.publishing}>
        <p>{data.doing ?? text.publishing}</p>
      </ScreenCard>
    );
  if ("offer" in data) {
    const { places, chosen } = data.offer;
    const plan = picked ?? chosen;
    return (
      <ScreenCard
        title={text.title[data.is]}
        actions={
          <ScreenActions>
            {plan === undefined
              ? null
              : press(text.publish, "publish", { plan }, "primary")}
          </ScreenActions>
        }
      >
        <Fault fault={fault} />
        {places.length > 1 ? (
          <RadioGroup
            label={text.places}
            options={places.map((place) => ({
              id: place.handle,
              label: place.about,
            }))}
            choice={plan ?? null}
            onChoose={setPicked}
            disabled={submitting}
            look={{
              slot: "publish-places",
              group: styles.lines,
              option: styles.place,
            }}
          >
            {(option) => option.label}
          </RadioGroup>
        ) : (
          <p>{places[0]?.about}</p>
        )}
      </ScreenCard>
    );
  }
  const { where } = data;
  if (data.is === "taking-down")
    return (
      <ScreenCard title={text.title["taking-down"]}>
        <Lines where={where} />
      </ScreenCard>
    );
  if (sure)
    return (
      <TakeDownSure
        where={where}
        act={act}
        submitting={submitting}
        fault={fault}
        keep={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSure(false)}
          >
            {text.takeDown.no}
          </Button>
        }
      />
    );
  const { keep } = where;
  return (
    <ScreenCard
      title={text.title[data.is]}
      actions={
        <ScreenActions>
          {where.plan === undefined || data.is === "published"
            ? null
            : press(
                data.is === "failed" ? text.again : text.publishChanges,
                "publish",
                { plan: where.plan },
                "primary",
              )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={submitting}
            onClick={() => setSure(true)}
          >
            {text.takeDown.ask}
          </Button>
          {press(text.gone, "gone")}
        </ScreenActions>
      }
    >
      <Fault fault={fault} />
      {data.is === "failed" ? (
        <p role="alert">{data.why ?? text.failed[data.doing]}</p>
      ) : null}
      {data.is === "changes" ? <p>{text.changes}</p> : null}
      <Lines where={where} />
      {keep === undefined ? null : (
        <span>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              window.open(keep.link, "_blank", "noopener,noreferrer")
            }
          >
            {text.keep.open}
          </Button>{" "}
          {press(text.keep.kept, "kept")}
        </span>
      )}
    </ScreenCard>
  );
}

export default Published;

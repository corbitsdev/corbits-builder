/**
 * Where publishing the app stands, as the hub worked it out. The view only draws it; each button
 * runs one of the publish plugin's actions, and Take it down asks on the screen itself first.
 */
import { useState, type ReactNode } from "react";
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { ScreenActions } from "@corbits-builder/plugin-ui/screen-actions";
import { ScreenCard } from "@corbits-builder/plugin-ui/screen-card";
import { RadioGroup } from "@corbits-builder/plugin-ui/choice-segments";
import { Button, formatRelativeTime } from "@corbits/react-ui";
import { Tooltip } from "@corbits/react-ui/ui/tooltip";
import { text, type Shown, type Where } from "./definition.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<
  Record<string, never>,
  Record<string, never>,
  Shown
>;

type Variant = "primary" | "outline" | "destructive" | "link";

/** The address as people type it; the link keeps the scheme. */
const shortUrl = (url: string) => url.replace(/^https?:\/\//, "");

/** A place to publish to, by its name, then the rest of what its package says, quieter. */
export function Place({ about }: { about: string }) {
  const split = about.indexOf(": ");
  if (split === -1) return <span className={styles.placeName}>{about}</span>;
  const detail = about.slice(split + 2);
  return (
    <span className={styles.place}>
      <span className={styles.placeName}>{about.slice(0, split)}</span>
      {/* Descriptions read "Name: detail", so the detail starts lower case. */}
      <span className={styles.quiet}>
        {detail.charAt(0).toUpperCase() + detail.slice(1)}
      </span>
    </span>
  );
}

/** What is published: the address first, then when, where and what it costs. */
function Lines({ where, live }: { where: Where; live: boolean }) {
  const { release, holding } = where;
  if (release === undefined && holding === undefined) return null;
  return (
    <>
      {release === undefined ? null : <Address url={release.url} live={live} />}
      <span className={styles.meta} data-slot="publish-published">
        {release === undefined ? null : (
          <Tooltip label={new Date(release.at).toLocaleString()}>
            <time dateTime={release.at} tabIndex={0}>
              {text.publishedAt(formatRelativeTime(release.at))}
            </time>
          </Tooltip>
        )}
        {holding === undefined ? null : (
          <span>{text.hosted(holding.place, holding.costs)}</span>
        )}
      </span>
    </>
  );
}

/** The address, as a link while people can open it. */
function Address({ url, live }: { url: string; live: boolean }) {
  return live ? (
    <a className={styles.address} href={url} target="_blank" rel="noreferrer">
      {shortUrl(url)}
    </a>
  ) : (
    <span className={styles.address}>{shortUrl(url)}</span>
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
  variant?: Variant;
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

/**
 * Take your app down?, with what the place says goes and what stops being charged. Take it down sits
 * at the far end of the card's row and the confirmation starts from the near end, so the second
 * click of a double click lands on neither of its buttons.
 */
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
          {keep}
          <Press
            label={text.takeDown.yes}
            action="take-down"
            variant="destructive"
            act={act}
            submitting={submitting}
          />
        </ScreenActions>
      }
    >
      <div className={styles.stack}>
        <Fault fault={fault} />
        {where.release === undefined ? null : (
          <Address url={where.release.url} live={false} />
        )}
        <span>{where.removes ?? text.takeDown.removes}</span>
        {where.holding?.costs === undefined ? null : (
          <span>
            {text.takeDown.costs(where.holding.place, where.holding.costs)}
          </span>
        )}
      </div>
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
    variant: Variant = "outline",
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
  // A button held disabled in its place, so the row keeps its shape: the pressed action while it
  // runs, or Publish until a place is picked.
  const still = (label: string, variant: Variant, className?: string) => (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={className}
      disabled
    >
      {label}
    </Button>
  );
  if (data.is === "publishing")
    return (
      <ScreenCard
        title={text.title.publishing}
        actions={
          <ScreenActions>{still(text.publish, "primary")}</ScreenActions>
        }
      >
        {null}
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
              ? still(text.publish, "primary")
              : press(text.publish, "publish", { plan }, "primary")}
          </ScreenActions>
        }
      >
        <div className={styles.stack}>
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
                group: styles.places,
                option: styles.option,
              }}
            >
              {(option) => <Place about={option.label} />}
            </RadioGroup>
          ) : (
            places.map((place) => (
              <Place key={place.handle} about={place.about} />
            ))
          )}
        </div>
      </ScreenCard>
    );
  }
  const { where } = data;
  const held = where.release !== undefined || where.holding !== undefined;
  if (data.is === "taking-down")
    return (
      <ScreenCard
        title={text.title["taking-down"]}
        actions={
          <ScreenActions>
            {still(text.takeDown.ask, "outline", styles.takeDown)}
          </ScreenActions>
        }
      >
        <div className={styles.stack}>
          <Lines where={where} live={false} />
        </div>
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
  const failed = data.is === "failed";
  const again = failed ? text.again : text.publishChanges;
  const republish = press(again, "publish", { plan: where.plan }, "primary");
  const offered =
    where.release?.replaceable === false ? (
      <Tooltip label={text.newAddress}>{republish}</Tooltip>
    ) : (
      republish
    );
  return (
    <ScreenCard
      title={
        data.is === "failed" ? text.failed[data.doing] : text.title[data.is]
      }
      actions={
        <ScreenActions>
          {where.plan === undefined ||
          data.is === "published" ||
          data.is === "working"
            ? null
            : offered}
          {held && (failed || keep?.passed === true)
            ? press(text.gone, "gone", {}, "link")
            : null}
          {held ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={styles.takeDown}
              disabled={submitting}
              onClick={() => setSure(true)}
            >
              {text.takeDown.ask}
            </Button>
          ) : null}
        </ScreenActions>
      }
    >
      <div className={styles.stack}>
        <Fault fault={fault} />
        {data.is === "failed" && data.why !== undefined ? (
          <p role="alert">{data.why}</p>
        ) : null}
        <Lines where={where} live />
        {keep?.passed === true ? (
          <span className={styles.quiet}>{text.keep.passed(keep.place)}</span>
        ) : null}
        {keep?.passed === false ? (
          <span className={styles.keep}>
            <a href={keep.link} target="_blank" rel="noreferrer">
              {text.keep.open(keep.place)}
            </a>
            <span className={styles.quiet}>{text.keep.until(keep.until)}</span>
            {press(text.keep.kept, "kept", {}, "link")}
          </span>
        ) : null}
      </div>
    </ScreenCard>
  );
}

export default Published;

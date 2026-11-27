// The Publish tab: where the app is published, and the buttons that run the plugin's tasks.
import { useId, useState, type ReactNode } from "react";
import {
  CirclePause,
  Clock,
  CloudOff,
  CloudUpload,
  Ellipsis,
  ExternalLink,
  Globe,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import type { ScreenViewProps } from "@corbits-builder/plugin-ui/screen";
import { Button, EmptyState } from "@corbits/react-ui";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { Address } from "../points.tsx";
import { text } from "./definition.ts";
import type { PublishHolding } from "@corbits-builder/publish-contract";
import type { PublishKeepNotice, Publishing } from "./state.ts";
import styles from "./view.module.css";

type Props = ScreenViewProps<unknown, unknown, Publishing>;

// What a button does: runs one of the plugin's tasks.
type Run = (action: string, input?: Record<string, unknown>) => void;

/** A turning circle for work under way, still for a reader who asked for less motion. */
function Spinner() {
  return <LoaderCircle className={styles.spinner} aria-hidden="true" />;
}

/** A short note in supporting text. */
function Note({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className={styles.note} id={id}>
      {children}
    </p>
  );
}

/** Where the app is now, when it went out, and where it is hosted while that is recorded. */
function Where({ url, at, held }: { url: string; at: string; held: Held }) {
  return (
    <span className={styles.lines}>
      <Address url={url} label={text.addressLabel(url)} />
      <span>{text.publishedAt(at)}</span>
      {held(true)}
    </span>
  );
}

/** A state's wording, with where the app is hosted below it while that is recorded. */
function Lines({ lead, held }: { lead: ReactNode; held: Held }) {
  return (
    <span className={styles.lines}>
      <span>{lead}</span>
      {held(false)}
    </span>
  );
}

/** Opens the published app in a new tab. */
function OpenApp({ url }: { url: string }) {
  return (
    <Button asChild variant="outline">
      <a href={url} target="_blank" rel="noreferrer">
        <ExternalLink size={16} aria-hidden="true" />
        {text.open}
      </a>
    </Button>
  );
}

/**
 * The way to keep an app on a temporary account, and to say whether it was kept. The link works
 * like a password, so it is never shown or put in an address: the button opens it in a new tab.
 * Before the deadline the only offer is to keep it. After the deadline the records cannot tell, so
 * the person says which, and either answer clears the notice. again is the button to publish once
 * more after the deadline, because the state below offers none then.
 */
function KeepApp({
  keep,
  again,
  run,
  busy,
}: {
  keep: PublishKeepNotice;
  again: ReactNode;
  run: Run;
  busy: boolean;
}) {
  const say = (label: string, onClick: () => void) => (
    <Button type="button" variant="outline" disabled={busy} onClick={onClick}>
      {label}
    </Button>
  );
  if (keep.passed)
    return (
      <section className={styles.banner} aria-label={text.keep.passed.heading}>
        <p className={styles.heading}>{text.keep.passed.heading}</p>
        <p>{text.keep.passed.lead(keep.place)}</p>
        <Note>{text.keep.passed.which}</Note>
        <div className={styles.actions}>
          {say(busy ? text.keep.saving : text.keep.kept, () => run("kept"))}
          {say(text.keep.passed.gone, () => run("gone", { what: "keep" }))}
        </div>
        {again === null ? null : (
          <>
            <p>{text.keep.passed.again}</p>
            <div className={styles.actions}>{again}</div>
          </>
        )}
      </section>
    );
  return (
    <section className={styles.banner} aria-label={text.keep.heading}>
      <div className={styles.keepHead}>
        <p className={styles.heading}>{text.keep.heading}</p>
        <p className={styles.left} role="timer">
          <Clock size={14} aria-hidden="true" />
          {text.keep.left(keep.minutesLeft)}
        </p>
      </div>
      <p>{text.keep.lead(keep.place)}</p>
      <Note>{text.keep.share}</Note>
      <div className={styles.keepFoot}>
        <Button
          type="button"
          onClick={() =>
            window.open(keep.link, "_blank", "noopener,noreferrer")
          }
        >
          {text.keep.action}
        </Button>
        <AskedTwice place={keep.place} onYes={() => run("kept")} busy={busy} />
      </div>
    </section>
  );
}

/**
 * Records that the person kept the app, asking twice first, because clearing the notice loses the
 * only way back to the link. The second ask replaces the first, with focus on the answer that
 * changes nothing. Going back returns focus to where it was.
 */
function AskedTwice({
  place,
  onYes,
  busy,
}: {
  place: string;
  onYes: () => void;
  busy: boolean;
}) {
  const [sure, setSure] = useState(false);
  const [back, setBack] = useState(false);
  const lead = useId();
  const notYet = () => {
    setSure(false);
    setBack(true);
  };
  // While it saves, the answer given stays on screen.
  if (!sure && !busy)
    return (
      <div className={styles.already}>
        <Note>{text.keep.already}</Note>
        <Button
          type="button"
          variant="outline"
          size="sm"
          autoFocus={back}
          onClick={() => setSure(true)}
        >
          {text.keep.kept}
        </Button>
      </div>
    );
  return (
    <div
      className={styles.sure}
      role="group"
      aria-labelledby={lead}
      data-slot="publish-sure"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) notYet();
      }}
    >
      <Note id={lead}>{text.keep.sure.lead(place)}</Note>
      <div className={styles.actions}>
        <Button type="button" variant="outline" disabled={busy} onClick={onYes}>
          {busy ? text.keep.saving : text.keep.sure.yes}
        </Button>
        <Button
          type="button"
          variant="outline"
          autoFocus
          disabled={busy}
          onClick={notYet}
        >
          {text.keep.sure.notYet}
        </Button>
      </div>
    </div>
  );
}

/**
 * Where the app is hosted, drawn by whichever state shows. published is true when the state already
 * shows when the app went out, so no second date is given.
 */
type Held = (published: boolean) => ReactNode;

/**
 * Says something is gone that only the person can know about, such as hosting they removed
 * themselves. It sits in a menu beside the fact it is about and asks twice, as deleting a project
 * does, because saying it by mistake hides what is still there.
 */
function GoneMenu({
  options,
  gone,
  sure,
  onGone,
  busy,
}: {
  options: string;
  gone: string;
  sure: string;
  onGone: () => void;
  busy: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Menu
      onOpenChange={(open) => {
        if (!open) setConfirming(false);
      }}
    >
      <MenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={options}>
          <Ellipsis aria-hidden="true" />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {confirming ? (
          <MenuItem disabled={busy} onSelect={onGone}>
            {sure}
          </MenuItem>
        ) : (
          <MenuItem
            disabled={busy}
            onSelect={(event) => {
              event.preventDefault();
              setConfirming(true);
            }}
          >
            {gone}
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

/**
 * Where a target set up hosting for the app and what it costs. It is a plain fact of the state, not a
 * notice, because publishing there means paying for hosting. Only the target's own tools clear it,
 * once its provider confirms it is gone. For hosting the person removed themselves, its menu lets
 * them say so.
 */
function HeldFacts({
  holding,
  published,
  run,
  busy,
}: {
  holding: PublishHolding;
  published: boolean;
  run: Run;
  busy: boolean;
}) {
  const words = text.holding;
  return (
    <span className={styles.fact} data-slot="publish-holding">
      <span>
        {published
          ? words.hosted(holding.place, holding.costs)
          : words.since(holding.place, holding.costs, holding.since)}
      </span>
      <GoneMenu
        options={words.options(holding.place)}
        gone={words.gone(holding.place)}
        sure={words.sure(holding.place)}
        onGone={() => run("gone", { what: "holding" })}
        busy={busy}
      />
    </span>
  );
}

export function Published({
  prepared: { data },
  act,
  submitting,
  fault,
}: Props) {
  // The room hands every screen it shows on its own the way to run the plugin's tasks.
  if (act === undefined)
    throw new Error("The Publish tab is shown without act");
  const run: Run = (action, input) => {
    void act(action, input);
  };
  const press = (label: string) => (
    <Button
      type="button"
      disabled={submitting}
      onClick={() => run("ask", { for: "publish" })}
    >
      <CloudUpload size={16} aria-hidden="true" />
      {label}
    </Button>
  );
  const { holding } = data;
  const held: Held = (published) =>
    holding === null ? null : (
      <HeldFacts
        holding={holding}
        published={published}
        run={run}
        busy={submitting}
      />
    );
  const standing = (
    <Standing
      state={data.state}
      press={press}
      run={run}
      busy={submitting}
      held={held}
    />
  );
  const offer = data.takeDown ? (
    <div className={styles.takeDown} data-slot="publish-take-down">
      <Note>{text.takeDown.note}</Note>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={submitting}
        onClick={() => run("ask", { for: "takeDown" })}
      >
        <CloudOff size={16} aria-hidden="true" />
        {text.takeDown.action}
      </Button>
    </div>
  ) : null;
  const failed =
    fault === undefined ? null : (
      <p className={styles.fault} role="alert">
        {fault}
      </p>
    );
  if (data.keep === null && failed === null && offer === null) return standing;
  return (
    <div className={styles.stack} data-slot="publish-notices">
      {data.keep === null ? null : (
        <div className={styles.notice} data-slot="publish-keep">
          <KeepApp
            keep={data.keep}
            again={
              data.state.state === "published"
                ? press(text.keep.passed.action)
                : null
            }
            run={run}
            busy={submitting}
          />
        </div>
      )}
      {standing}
      {failed}
      {offer}
    </div>
  );
}

// The states drawn alike: an icon, a title, a lead with where the app is hosted below it, and the
// publish button for a state that offers one.
const PLAIN = {
  needsYou: { icon: <CirclePause />, role: "status" },
  publishing: { icon: <Spinner />, role: "status" },
  takingDown: { icon: <Spinner />, role: "status" },
  stalled: { icon: <CirclePause />, role: undefined },
  failed: { icon: <TriangleAlert />, role: "alert" },
  unpublished: { icon: <CloudUpload />, role: undefined },
} as const;

/** What the publishing state shows, below the keep link while there is one. */
function Standing({
  state: publish,
  press,
  run,
  busy,
  held,
}: {
  state: Publishing["state"];
  press: (label: string) => ReactNode;
  run: Run;
  busy: boolean;
  held: Held;
}) {
  const state = (
    icon: ReactNode,
    title: string,
    description: ReactNode,
    action?: ReactNode,
    role?: "status" | "alert",
  ) => (
    <div className={styles.state} role={role} data-slot="publish">
      <EmptyState
        icon={icon}
        title={title}
        description={description}
        action={action}
      />
    </div>
  );
  if (publish.state === "published")
    return state(
      <Globe />,
      text.published.title,
      <Where url={publish.url} at={publish.at} held={held} />,
      <OpenApp url={publish.url} />,
    );
  if (publish.state === "changes")
    return state(
      <Globe />,
      text.changes.title,
      <>
        {text.changes.lead}{" "}
        <Where url={publish.url} at={publish.at} held={held} />
      </>,
      press(text.changes.action),
    );
  if (publish.state === "takeDownFailed") {
    const words = text.takeDownFailed;
    const lead = publish.reason ?? words.lead;
    return state(
      <TriangleAlert />,
      words.title,
      <Lines
        lead={
          publish.released ? (
            <span className={styles.fact}>
              <span>{lead}</span>
              <GoneMenu
                options={words.options}
                gone={words.gone}
                sure={words.sure}
                onGone={() => run("gone", { what: "release" })}
                busy={busy}
              />
            </span>
          ) : (
            lead
          )
        }
        held={held}
      />,
      // A failed take-down is retried by asking for it again, never by publishing.
      <Button
        type="button"
        disabled={busy}
        onClick={() => run("ask", { for: "takeDown" })}
      >
        {words.action}
      </Button>,
      "alert",
    );
  }
  const { icon, role } = PLAIN[publish.state];
  const words = text[publish.state];
  return state(
    icon,
    words.title,
    <Lines
      lead={("reason" in publish ? publish.reason : undefined) ?? words.lead}
      held={held}
    />,
    "action" in words ? press(words.action) : undefined,
    role,
  );
}

export default Published;

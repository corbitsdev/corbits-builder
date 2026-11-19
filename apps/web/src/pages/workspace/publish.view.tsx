/**
 * The project view's Publish tab. It shows where the app is published and the button to publish
 * it, or the question publishing waits on, depending on where publishing stands. Above that, while
 * one is recorded, is the link to keep an app on a temporary account. The state's facts include
 * where the app is hosted and what that costs. Below the state is a quiet way to ask for the app to
 * be taken down, and a quieter one to say it is gone when no take-down can reach it.
 */
import { useId, useState, type ReactNode } from "react";
import {
  CloudOff,
  CirclePause,
  CloudUpload,
  Ellipsis,
  ExternalLink,
  Globe,
  TriangleAlert,
} from "lucide-react";
import { Button, EmptyState } from "@corbits/react-ui";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@corbits/react-ui/ui/menu";
import { wording } from "../../config.ts";
import {
  Banner,
  BannerAction,
  Fault,
  InlineNote,
  Spinner,
} from "../../components.tsx";
import type {
  PublishHoldingNotice,
  PublishKeepNotice,
  Publishing,
} from "./publish-state.ts";
import styles from "./publish.module.css";

const text = wording.publish;

export type PublishViewProps = {
  publish: Publishing;
  /** Asks the coordinator, in the person's own words, to publish; absent when they cannot. */
  onPublish?: (() => void) | undefined;
  /** That message is on its way. */
  sending: boolean;
  /** The open question publishing waits on, drawn here instead of in the conversation, or null. */
  question: ReactNode;
  /** Says the person kept the app, which clears the keep link; absent when they cannot. */
  onKept?: (() => void) | undefined;
  /**
   * Says the person did not keep the app before the deadline, which clears the keep link and its
   * release; absent when they cannot.
   */
  onGone?: (() => void) | undefined;
  /** Either is being saved. */
  keeping: boolean;
  /** Why it was not saved; null while nothing failed. */
  keptFault: string | null;
  /**
   * Asks the coordinator, in the person's own words, to take the app down; absent when they
   * cannot. The person decides on the screen it opens.
   */
  onTakeDown?: (() => void) | undefined;
  /**
   * Says the target's holding for the app is gone, as when the person removed it themselves, which
   * clears it; absent when they cannot.
   */
  onHeldGone?: (() => void) | undefined;
  /**
   * Says an app no take-down could reach is gone, as when the person cancelled its server, which
   * clears the release; absent when they cannot.
   */
  onReleaseGone?: (() => void) | undefined;
  /** Either is being saved. */
  clearing: boolean;
  /** Why it was not saved; null while nothing failed. */
  clearFault: string | null;
};

/** Where the app is now, when it went out, and where it is hosted while that is recorded. */
function Where({ url, at, held }: { url: string; at: string; held: Held }) {
  return (
    <span className={styles.lines}>
      <a
        className={styles.address}
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={`${text.address}: ${url}`}
      >
        {url}
      </a>
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
  onKept,
  onGone,
  keeping,
  keptFault,
}: {
  keep: PublishKeepNotice;
  again: ReactNode;
  onKept: (() => void) | undefined;
  onGone: (() => void) | undefined;
  keeping: boolean;
  keptFault: string | null;
}) {
  const say = (label: string, onClick: () => void) => (
    <Button
      type="button"
      variant="outline"
      disabled={keeping}
      onClick={onClick}
    >
      {label}
    </Button>
  );
  const fault = keptFault === null ? null : <Fault>{keptFault}</Fault>;
  if (keep.passed)
    return (
      <Banner title={text.keep.passed.heading}>
        <p>{text.keep.passed.lead(keep.place)}</p>
        {onKept === undefined || onGone === undefined ? null : (
          <>
            <InlineNote>{text.keep.passed.which}</InlineNote>
            <BannerAction>
              {say(keeping ? text.keep.keeping : text.keep.kept, onKept)}
              {say(text.keep.passed.gone, onGone)}
            </BannerAction>
            {fault}
          </>
        )}
        {again === null ? null : (
          <>
            <p>{text.keep.passed.again}</p>
            <BannerAction>{again}</BannerAction>
          </>
        )}
      </Banner>
    );
  const kept =
    onKept === undefined ? null : (
      <>
        <AskedTwice
          words={{
            already: text.keep.already,
            say: text.keep.kept,
            lead: text.keep.sure.lead(keep.place),
            yes: text.keep.sure.yes,
            notYet: text.keep.sure.notYet,
            saving: text.keep.keeping,
          }}
          onYes={onKept}
          saving={keeping}
        />
        {fault}
      </>
    );
  return (
    <Banner title={text.keep.heading}>
      <p>{text.keep.lead(keep.place)}</p>
      <p role="timer">{text.keep.left(keep.minutesLeft)}</p>
      <BannerAction>
        <Button
          type="button"
          onClick={() =>
            window.open(keep.link, "_blank", "noopener,noreferrer")
          }
        >
          {text.keep.action}
        </Button>
      </BannerAction>
      <InlineNote>{text.keep.share}</InlineNote>
      {kept}
    </Banner>
  );
}

/**
 * Records something the records cannot tell on their own, asking twice first, because clearing the
 * notice loses the only way back to it, such as the link that keeps an app. The second ask
 * replaces the first, with focus on the answer that changes nothing. Going back returns focus to
 * where it was.
 */
function AskedTwice({
  words,
  onYes,
  saving,
}: {
  words: {
    already: string;
    say: string;
    lead: string;
    yes: string;
    notYet: string;
    saving: string;
  };
  onYes: () => void;
  saving: boolean;
}) {
  const [sure, setSure] = useState(false);
  const [back, setBack] = useState(false);
  const lead = useId();
  const notYet = () => {
    setSure(false);
    setBack(true);
  };
  // While it saves, the answer given stays on screen.
  if (!sure && !saving)
    return (
      <>
        <InlineNote>{words.already}</InlineNote>
        <BannerAction>
          <Button
            type="button"
            variant="outline"
            autoFocus={back}
            onClick={() => setSure(true)}
          >
            {words.say}
          </Button>
        </BannerAction>
      </>
    );
  return (
    <div
      className={styles.sure}
      role="group"
      aria-labelledby={lead}
      data-slot="publish-sure"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) notYet();
      }}
    >
      <InlineNote id={lead}>{words.lead}</InlineNote>
      <BannerAction>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onYes}
        >
          {saving ? words.saving : words.yes}
        </Button>
        <Button
          type="button"
          variant="outline"
          autoFocus
          disabled={saving}
          onClick={notYet}
        >
          {words.notYet}
        </Button>
      </BannerAction>
    </div>
  );
}

/**
 * Where the app is hosted, drawn by whichever state shows. published is true when the state
 * already shows when the app went out, so no second date is given.
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
  clearing,
}: {
  options: string;
  gone: string;
  sure: string;
  onGone: () => void;
  clearing: boolean;
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
          <MenuItem disabled={clearing} onSelect={onGone}>
            {sure}
          </MenuItem>
        ) : (
          <MenuItem
            disabled={clearing}
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
 * Where a target set up hosting for the app and what it costs. It is a plain fact of the state,
 * not a notice, because publishing there means paying for hosting. Only the target's own tools
 * clear it, once its provider confirms it is gone. For hosting the person removed themselves, its
 * menu lets them say so.
 */
function HeldFacts({
  holding,
  published,
  onGone,
  clearing,
}: {
  holding: PublishHoldingNotice;
  published: boolean;
  onGone: (() => void) | undefined;
  clearing: boolean;
}) {
  const words = text.holding;
  return (
    <span className={styles.fact} data-slot="publish-holding">
      <span>
        {published
          ? words.hosted(holding.place, holding.costs)
          : words.since(holding.place, holding.costs, holding.since)}
      </span>
      {onGone === undefined ? null : (
        <GoneMenu
          options={words.options(holding.place)}
          gone={words.gone(holding.place)}
          sure={words.sure(holding.place)}
          onGone={onGone}
          clearing={clearing}
        />
      )}
    </span>
  );
}

/** The quiet way to ask for the app to be taken down, under the state and apart from its button. */
function TakeDownOffer({
  onTakeDown,
  sending,
}: {
  onTakeDown: () => void;
  sending: boolean;
}) {
  return (
    <div className={styles.takeDown} data-slot="publish-take-down">
      <InlineNote>{text.takeDown.note}</InlineNote>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={sending}
        onClick={onTakeDown}
      >
        <CloudOff size={16} aria-hidden="true" />
        {text.takeDown.action}
      </Button>
    </div>
  );
}

export function PublishView({
  publish,
  onPublish,
  sending,
  question,
  onKept,
  onGone,
  keeping,
  keptFault,
  onTakeDown,
  onHeldGone,
  onReleaseGone,
  clearing,
  clearFault,
}: PublishViewProps) {
  const press = (label: string) =>
    onPublish === undefined ? null : (
      <Button type="button" disabled={sending} onClick={onPublish}>
        <CloudUpload size={16} aria-hidden="true" />
        {label}
      </Button>
    );
  // A failed take-down is retried by asking for it again, never by publishing.
  const pressTakeDown = (label: string) =>
    onTakeDown === undefined ? null : (
      <Button type="button" disabled={sending} onClick={onTakeDown}>
        {label}
      </Button>
    );
  const { holding } = publish;
  const held: Held = (published) =>
    holding === null ? null : (
      <HeldFacts
        holding={holding}
        published={published}
        onGone={onHeldGone}
        clearing={clearing}
      />
    );
  const standing = (
    <Standing
      state={publish.state}
      press={press}
      pressTakeDown={pressTakeDown}
      question={question}
      held={held}
      onReleaseGone={onReleaseGone}
      clearing={clearing}
    />
  );
  const offer =
    publish.takeDown && onTakeDown !== undefined ? (
      <TakeDownOffer onTakeDown={onTakeDown} sending={sending} />
    ) : null;
  const fault =
    clearFault === null ? null : (
      <div className={styles.goneFault}>
        <Fault>{clearFault}</Fault>
      </div>
    );
  if (publish.keep === null && fault === null && offer === null)
    return standing;
  return (
    <div className={styles.stack} data-slot="publish-notices">
      {publish.keep === null ? null : (
        <div className={styles.notice} data-slot="publish-keep">
          <KeepApp
            keep={publish.keep}
            again={
              publish.state.state === "published"
                ? press(text.keep.passed.action)
                : null
            }
            onKept={onKept}
            onGone={onGone}
            keeping={keeping}
            keptFault={keptFault}
          />
        </div>
      )}
      {standing}
      {fault}
      {offer}
    </div>
  );
}

/** What the publishing state shows, below the keep link while there is one. */
function Standing({
  state: publish,
  press,
  pressTakeDown,
  question,
  held,
  onReleaseGone,
  clearing,
}: {
  state: Publishing["state"];
  press: (label: string) => ReactNode;
  pressTakeDown: (label: string) => ReactNode;
  question: ReactNode;
  held: Held;
  onReleaseGone: (() => void) | undefined;
  clearing: boolean;
}) {
  if (publish.state === "needsYou") {
    const facts = held(false);
    return (
      <div className={styles.question} data-slot="publish-question">
        {question ?? (
          <InlineNote role="status">
            {wording.questions.screenLoading}
          </InlineNote>
        )}
        {facts === null ? null : <InlineNote>{facts}</InlineNote>}
      </div>
    );
  }
  if (publish.state === "publishing")
    return (
      <div className={styles.state} role="status" data-slot="publish">
        <EmptyState
          icon={<Spinner />}
          title={text.publishing.title}
          description={<Lines lead={text.publishing.lead} held={held} />}
        />
      </div>
    );
  if (publish.state === "takingDown")
    return (
      <div className={styles.state} role="status" data-slot="publish">
        <EmptyState
          icon={<Spinner />}
          title={text.takingDown.title}
          description={<Lines lead={text.takingDown.lead} held={held} />}
        />
      </div>
    );
  if (publish.state === "takeDownFailed") {
    const words = text.takeDownFailed;
    const lead = publish.reason ?? words.lead;
    return (
      <div className={styles.state} role="alert" data-slot="publish">
        <EmptyState
          icon={<TriangleAlert />}
          title={words.title}
          description={
            <Lines
              lead={
                publish.released && onReleaseGone !== undefined ? (
                  <span className={styles.fact}>
                    <span>{lead}</span>
                    <GoneMenu
                      options={words.options}
                      gone={words.gone}
                      sure={words.sure}
                      onGone={onReleaseGone}
                      clearing={clearing}
                    />
                  </span>
                ) : (
                  lead
                )
              }
              held={held}
            />
          }
          action={pressTakeDown(words.action)}
        />
      </div>
    );
  }
  if (publish.state === "stalled")
    return (
      <div className={styles.state} data-slot="publish">
        <EmptyState
          icon={<CirclePause />}
          title={text.stalled.title}
          description={<Lines lead={text.stalled.lead} held={held} />}
          action={press(text.stalled.action)}
        />
      </div>
    );
  if (publish.state === "published")
    return (
      <div className={styles.state} data-slot="publish">
        <EmptyState
          icon={<Globe />}
          title={text.published.title}
          description={<Where url={publish.url} at={publish.at} held={held} />}
          action={<OpenApp url={publish.url} />}
        />
      </div>
    );
  if (publish.state === "changes")
    return (
      <div className={styles.state} data-slot="publish">
        <EmptyState
          icon={<Globe />}
          title={text.changes.title}
          description={
            <>
              {text.changes.lead}{" "}
              <Where url={publish.url} at={publish.at} held={held} />
            </>
          }
          action={press(text.changes.action)}
        />
      </div>
    );
  if (publish.state === "failed")
    return (
      <div className={styles.state} role="alert" data-slot="publish">
        <EmptyState
          icon={<TriangleAlert />}
          title={text.failed.title}
          description={
            <Lines lead={publish.reason ?? text.failed.lead} held={held} />
          }
          action={press(text.failed.action)}
        />
      </div>
    );
  return (
    <div className={styles.state} data-slot="publish">
      <EmptyState
        icon={<CloudUpload />}
        title={text.unpublished.title}
        description={<Lines lead={text.unpublished.lead} held={held} />}
        action={press(text.unpublished.action)}
      />
    </div>
  );
}

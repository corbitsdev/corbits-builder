/**
 * A piece of work as one row in the room, the same row from start to end: the specialist, what it
 * works on and where it stands as its header; its steps as the thread's own run of steps, each
 * added as it happens, open while it works and folded once it ends; then what it filed, its
 * report, and each approval for what it made.
 */
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Button,
  ConversationItem,
  Message,
  MessageHeader,
  type PartTool,
} from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { Markdown } from "@corbits-builder/plugin-ui/markdown";
import type { Dispatch, DispatchStatus } from "./dispatch-card.tsx";
import { useElapsedMs } from "./elapsed.tsx";
import type { RunPreview } from "./run-preview.ts";
import styles from "./work-unit-message.module.css";
import type { DocumentApproval } from "./transcript.tsx";

const text = wording.dispatch;
const state = wording.activity.status;

/** A piece of work as its row shows it, by where its hand-off stands. */
export type WorkUnitStanding = {
  /** The work's hand-off, naming its row. */
  unitKey: string;
  /** Where the hand-off stands. */
  status: DispatchStatus;
  /** Who does the work. */
  role: Dispatch["role"];
  /** What it works on: "Constraints", "Quiet concept", "the app". */
  subject: string;
  /** Each call the specialist made while the room watched it, in order. */
  steps: readonly PartTool[];
  /** What the run is producing right now, from its own stream, while it works and frames arrive. */
  preview: RunPreview | undefined;
  /** What the specialist reported last, shown under its result once the work is done. */
  report: string | undefined;
  /** The approvals for what the work made. */
  approvals: readonly DocumentApproval[];
  /** Opens the document the work filed; absent where nothing can open it. */
  onOpenDocument: ((kind: string) => void) | undefined;
  /** Opens what the work makes as it makes it, offered while it works; absent where nothing shows it. */
  watch: { label: string; open: () => void } | undefined;
};

export type WorkUnitMessageViewProps = WorkUnitStanding & {
  /** The steps as the thread draws a run of them, open while `inProgress` unless the person chose. */
  run: (steps: readonly PartTool[], inProgress: boolean) => ReactNode;
  /** An approval for what the work made, pending or settled. */
  decision: (approval: DocumentApproval) => ReactNode;
};

function Elapsed({ since }: { since: string }) {
  const seconds = Math.floor(useElapsedMs(since) / 1_000);
  return (
    <span className={styles.time}>
      {wording.activity.elapsed(Math.floor(seconds / 60), seconds % 60)}
    </span>
  );
}

/** Where the work stands, beside its name: it never names the step it is on. */
function StateLabel({ status }: { status: DispatchStatus }): ReactNode {
  switch (status.state) {
    case "starting":
      return text.starting;
    case "working":
      return (
        <>
          {state.running} <Elapsed since={status.since} />
        </>
      );
    case "approval":
      return text.approval;
    case "ready":
    case "finished":
      return state["output-available"];
    case "failed":
      return state.error;
  }
}

// Within this many pixels of the end, the preview follows new text; scrolled further up, it stays put.
const FOLLOW_PX = 24;

/** What the run is writing as it arrives, about eight lines tall, the newest kept in view. */
function Preview({ preview }: { preview: RunPreview }) {
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const shown = preview.kind === "writing" ? preview.text : "";
  useLayoutEffect(() => {
    const element = box.current;
    if (element !== null && following.current)
      element.scrollTop = element.scrollHeight;
  }, [shown]);
  if (preview.kind === "thinking")
    return <p className={styles.thinking}>{text.thinkingThrough}</p>;
  return (
    <div
      ref={box}
      className={styles.preview}
      role="log"
      aria-label={text.preview}
      tabIndex={0}
      onScroll={(event) => {
        const element = event.currentTarget;
        following.current =
          element.scrollHeight - element.scrollTop - element.clientHeight <
          FOLLOW_PX;
      }}
    >
      <Markdown source={shown} />
    </div>
  );
}

/**
 * Under the steps: what the run is writing while it works, then the document it filed and its
 * report, or why it stopped.
 */
function WorkResult({
  status,
  preview,
  report,
  onOpen,
  watch,
}: {
  status: DispatchStatus;
  preview: RunPreview | undefined;
  report: string | undefined;
  onOpen: ((kind: string) => void) | undefined;
  watch: WorkUnitStanding["watch"];
}) {
  if (status.state === "working")
    return (
      <>
        {preview === undefined ? null : <Preview preview={preview} />}
        {watch === undefined ? null : (
          <Button
            type="button"
            variant="link"
            size="sm"
            className={styles.open}
            onClick={watch.open}
          >
            {watch.label}
          </Button>
        )}
      </>
    );
  if (status.state === "failed")
    return (
      <p className={styles.result} data-state="failed" title={status.reason}>
        {status.reason}
      </p>
    );
  const said = report === undefined ? null : <Report source={report} />;
  if (status.state !== "ready") return said;
  const ready = text.ready(status.title, status.version);
  return (
    <>
      <p className={styles.result}>
        <span className={styles.ready} title={ready}>
          {ready}
        </span>
        {onOpen === undefined ? null : (
          <Button
            type="button"
            variant="link"
            size="sm"
            className={styles.open}
            onClick={() => onOpen(status.kind)}
          >
            {text.open}
          </Button>
        )}
      </p>
      {said}
    </>
  );
}

/** The specialist's last report, two lines until the person asks for the rest. */
function Report({ source }: { source: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = box.current;
    if (element !== null && !open)
      setClipped(element.scrollHeight > element.clientHeight);
  }, [source, open]);
  return (
    <div className={styles.report}>
      <div
        ref={box}
        className={styles.reportText}
        data-open={open || undefined}
      >
        <Markdown source={source} />
      </div>
      {clipped ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className={styles.open}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? text.less : text.more}
        </Button>
      ) : null}
    </div>
  );
}

export function WorkUnitMessageView({
  unitKey,
  status,
  role,
  subject,
  steps,
  preview,
  report,
  approvals,
  onOpenDocument,
  watch,
  run,
  decision,
}: WorkUnitMessageViewProps) {
  const live = status.state === "starting" || status.state === "working";
  return (
    <ConversationItem itemId={`work:${unitKey}`}>
      <Message from="agent" status={live ? "streaming" : "sent"}>
        <MessageHeader name={wording.activity.role[role]} role={subject}>
          <span className={styles.state} data-state={status.state}>
            <StateLabel status={status} />
          </span>
        </MessageHeader>
        {run(steps, live || status.state === "approval")}
        <WorkResult
          status={status}
          preview={preview}
          report={report}
          onOpen={onOpenDocument}
          watch={watch}
        />
        {approvals.map((approval) => (
          <Fragment key={approval.approvalId}>{decision(approval)}</Fragment>
        ))}
      </Message>
    </ConversationItem>
  );
}

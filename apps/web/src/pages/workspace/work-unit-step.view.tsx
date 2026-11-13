/**
 * A piece of work as one step in the coordinator's list, the same step from start to end: the
 * specialist, what it does and where it stands as its row, with what the person can open beside it;
 * opened, what it was asked to do, its own steps one level in, each added as it happens, then what it is writing, why it
 * stopped, or its report. It opens once and only the person folds it, so its end does not move the
 * page.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Tool,
  ToolHeader,
  type PartTool,
  type ToolTraceStatus,
} from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { Markdown } from "@corbits-builder/plugin-ui/markdown";
import type { DispatchStatus } from "./dispatch-card.tsx";
import { useElapsedMs } from "./elapsed.tsx";
import type { RunPreview } from "./run-preview.ts";
import styles from "./work-unit-step.module.css";

const text = wording.dispatch;

/** Where the work stands, as a step's status. */
export const STEP_STATUS: Record<DispatchStatus["state"], ToolTraceStatus> = {
  starting: "pending",
  working: "running",
  approval: "approval-requested",
  ready: "output-available",
  finished: "output-available",
  failed: "error",
};

/** A piece of work as its step shows it, by where its hand-off stands. */
export type WorkUnitStanding = {
  /** The work's hand-off, naming its step. */
  unitKey: string;
  /** Where the hand-off stands. */
  status: DispatchStatus;
  /** Who does the work and what it does: "Coder · Building the code". */
  label: string;
  /** Each call the specialist made while the room watched it, in order. */
  steps: readonly PartTool[];
  /** What the run is producing right now, from its own stream, while it works and frames arrive. */
  preview: RunPreview | undefined;
  /** What the coordinator asked it to do; absent when the hand-off carried no instruction. */
  instruction: string | undefined;
  /** What the specialist reported last, shown under its steps once the work is done. */
  report: string | undefined;
  /** Opens the document the work filed; absent where nothing can open it. */
  onOpenDocument: ((kind: string) => void) | undefined;
  /** Opens what the work makes as it makes it, offered while it works; absent where nothing shows it. */
  watch: { label: string; open: () => void } | undefined;
};

export type WorkUnitStepViewProps = WorkUnitStanding & {
  /** The specialist's own steps as the thread draws a list of them. */
  run: (steps: readonly PartTool[]) => ReactNode;
};

/** The row while the work runs, its time counting up beside it. */
function WorkingHeader({ label, since }: { label: string; since: string }) {
  const seconds = Math.floor(useElapsedMs(since) / 1_000);
  const elapsed = wording.activity.elapsed(
    Math.floor(seconds / 60),
    seconds % 60,
  );
  return (
    <ToolHeader
      label={label}
      statusLabels={{ running: `${text.status.running} ${elapsed}` }}
      className={styles.row}
    />
  );
}

/** Beside the row: watch the work while it runs, or open what it filed. */
function RowAction({
  status,
  watch,
  onOpen,
}: {
  status: DispatchStatus;
  watch: WorkUnitStanding["watch"];
  onOpen: WorkUnitStanding["onOpenDocument"];
}) {
  if (status.state === "working" && watch !== undefined)
    return (
      <Button
        type="button"
        variant="link"
        size="sm"
        className={styles.action}
        onClick={watch.open}
      >
        {watch.label}
      </Button>
    );
  if (status.state === "ready" && onOpen !== undefined)
    return (
      <Button
        type="button"
        variant="link"
        size="sm"
        className={styles.action}
        aria-label={text.openNamed(status.title, status.version)}
        title={text.openNamed(status.title, status.version)}
        onClick={() => onOpen(status.kind)}
      >
        {text.open}
      </Button>
    );
  return null;
}

// Within this many pixels of the end, the preview follows new text; scrolled further up, it stays put.
const FOLLOW_PX = 24;

/**
 * What the run is writing as it arrives, about eight lines tall, the newest kept in view; else that
 * it is thinking, or waiting with nothing streaming in, so a working row never opens onto nothing.
 */
function Preview({ preview }: { preview: RunPreview | undefined }) {
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const shown = preview?.kind === "writing" ? preview.text : "";
  useLayoutEffect(() => {
    const element = box.current;
    if (element !== null && following.current)
      element.scrollTop = element.scrollHeight;
  }, [shown]);
  if (preview === undefined)
    return <p className={styles.thinking}>{text.waitingForStep}</p>;
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

/** Text held to a few lines until the person asks for the rest: a specialist's report, or its goal. */
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
          className={styles.action}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? text.less : text.more}
        </Button>
      ) : null}
    </div>
  );
}

export function WorkUnitStepView({
  unitKey,
  status,
  label,
  steps,
  preview,
  instruction,
  report,
  onOpenDocument,
  watch,
  run,
}: WorkUnitStepViewProps) {
  const [open, setOpen] = useState(true);
  // The library shows a toggle only for a row with input, so a row with nothing to open has none.
  const hasWork =
    instruction !== undefined ||
    steps.length > 0 ||
    report !== undefined ||
    status.state === "failed" ||
    preview?.kind === "writing";
  return (
    <Tool
      // The row opens onto its work, so its steps stand as its detail.
      part={{
        kind: "tool-trace",
        toolCallId: unitKey,
        name: "",
        status: STEP_STATUS[status.state],
        ...(hasWork ? { input: steps } : {}),
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <div className={styles.header}>
        {status.state === "working" ? (
          <WorkingHeader label={label} since={status.since} />
        ) : (
          <ToolHeader
            label={label}
            statusLabels={text.status}
            className={styles.row}
          />
        )}
        <RowAction status={status} watch={watch} onOpen={onOpenDocument} />
      </div>
      {open ? (
        <div className={styles.work}>
          {instruction === undefined ? null : (
            <div className={styles.goal}>
              <span className={styles.goalLabel}>{text.askedTo}</span>
              <Report source={instruction} />
            </div>
          )}
          {run(steps)}
          {status.state === "working" ? <Preview preview={preview} /> : null}
          {status.state === "failed" ? (
            <p className={styles.failed} title={status.reason}>
              {status.reason}
            </p>
          ) : null}
          {report === undefined ? null : <Report source={report} />}
        </div>
      ) : null}
    </Tool>
  );
}

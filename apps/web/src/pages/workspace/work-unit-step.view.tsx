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
import {
  DocumentBlock,
  type DocumentBlockProps,
} from "@corbits-builder/plugin-ui/document-block";
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
  // A run that ended early is a quiet state of its row, not an alarm: its words say how it ended.
  stopped: "output-denied",
  failed: "output-denied",
};

/** The words at the end of a row, by where its work stands. */
function statusLabels(status: DispatchStatus) {
  if (status.state === "stopped") return { "output-denied": text.stopped };
  if (status.state === "failed") return { "output-denied": text.status.error };
  return text.status;
}

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
  /** The document the work filed, shown under its row once done; absent for anything else. */
  document: DocumentBlockProps | undefined;
  /** Opens the document the work filed; absent where nothing can open it. */
  onOpenDocument: ((kind: string) => void) | undefined;
  /** Opens what the work makes as it makes it, offered while it works; absent where nothing shows it. */
  watch: { label: string; open: () => void } | undefined;
  /** Stops the work once the person confirms it, offered only while it works. */
  stop: { ask: string; confirm: () => Promise<void> } | undefined;
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

/** Stops the work, asking once in the row first. */
function StopAction({ stop }: { stop: NonNullable<WorkUnitStanding["stop"]> }) {
  const [asking, setAsking] = useState(false);
  const [stopping, setStopping] = useState(false);
  if (!asking)
    return (
      <Button
        type="button"
        variant="link"
        size="sm"
        className={styles.action}
        onClick={() => setAsking(true)}
      >
        {text.stop}
      </Button>
    );
  const confirm = async () => {
    setStopping(true);
    try {
      await stop.confirm();
    } finally {
      setStopping(false);
      setAsking(false);
    }
  };
  return (
    <span className={styles.ask} role="group" aria-label={stop.ask}>
      {stop.ask}
      <Button
        type="button"
        variant="link"
        size="sm"
        className={styles.action}
        disabled={stopping}
        onClick={() => void confirm()}
      >
        {text.stop}
      </Button>
      <Button
        type="button"
        variant="link"
        size="sm"
        className={styles.action}
        disabled={stopping}
        onClick={() => setAsking(false)}
      >
        {text.keepGoing}
      </Button>
    </span>
  );
}

/** Beside the row: watch the work while it runs, or open what it filed when no document block does. */
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
 * What the run is writing as it arrives, about eight lines tall, the newest kept in view; else the
 * newest two lines of its reasoning, or that it is thinking when its reasoning has no words to show;
 * else that it is waiting with nothing streaming in, so a working row never opens onto nothing.
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
  if (preview.kind === "thinking" && preview.text.trim() === "")
    return <p className={styles.thinking}>{text.thinkingThrough}</p>;
  if (preview.kind === "thinking")
    return (
      // Off, so a live region around the conversation does not read out every word as it arrives.
      <div className={styles.reasoning} aria-live="off">
        <p className={styles.reasoningText}>{preview.text}</p>
      </div>
    );
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
 * Says whether the text overflows its box now and again whenever the box or the text in it changes
 * size: the same words wrap onto more lines in a narrower column, and fewer in a wider one or once
 * the page's font arrives.
 */
export function watchClipping<
  Box extends { scrollHeight: number; clientHeight: number },
>(
  box: Box,
  onClipped: (clipped: boolean) => void,
  onResize: (box: Box, measure: () => void) => () => void,
): () => void {
  const measure = () => onClipped(box.scrollHeight > box.clientHeight);
  measure();
  return onResize(box, measure);
}

/** Calls `measure` whenever the element or one of its children changes size, until stopped. */
function resized(element: HTMLElement, measure: () => void): () => void {
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  for (const child of Array.from(element.children)) observer.observe(child);
  return () => observer.disconnect();
}

/** Text held to a few lines until the person asks for the rest: a specialist's report, or its goal. */
function Report({ source }: { source: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null || open) return;
    return watchClipping(element, setClipped, resized);
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
  document,
  onOpenDocument,
  watch,
  stop,
  run,
}: WorkUnitStepViewProps) {
  const [open, setOpen] = useState(true);
  // The library shows a toggle only for a row with input, so a row with nothing to open has none.
  const hasWork =
    instruction !== undefined ||
    steps.length > 0 ||
    report !== undefined ||
    document !== undefined ||
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
            statusLabels={statusLabels(status)}
            className={styles.row}
          />
        )}
        <RowAction
          status={status}
          watch={watch}
          onOpen={document === undefined ? onOpenDocument : undefined}
        />
        {stop === undefined ? null : <StopAction stop={stop} />}
      </div>
      {open ? (
        <div className={styles.work}>
          {document === undefined ? null : (
            <div className={styles.document}>
              <DocumentBlock {...document} />
            </div>
          )}
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

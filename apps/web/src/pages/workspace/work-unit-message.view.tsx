/**
 * A piece of work as one agent message through MessageParts: the hand-off and
 * the specialist's reports fold into one activity named by what came of it,
 * where it stands is one line, and each approval for what it made is a
 * ToolApproval in the same message that settles to its one quiet line.
 */
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ActivityContent,
  ActivityTrigger,
  Button,
  ConversationItem,
  Message,
  MessageHeader,
  MessageParts,
  ShimmerText,
  Tool,
  ToolHeader,
  ToolOutput,
  type ActivityStep,
  type ConversationMessage,
  type PartTool,
  type ToolApprovalDecision,
} from "@corbits/react-ui";
import { wording } from "../../config.ts";
import { Markdown } from "@corbits-builder/plugin-ui/markdown";
import type { Dispatch, DispatchStatus } from "./dispatch-card.tsx";
import { useElapsedMs } from "./elapsed.tsx";
import type { RunPreview } from "./run-preview.ts";
import styles from "./work-unit-message.module.css";
import type { DocumentApproval } from "./transcript.tsx";
import { WORK_RESULT_BLOCK } from "./work-unit.ts";

const text = wording.dispatch;

/** A piece of work as its message shows it, by where its hand-off stands. */
export type WorkUnitStanding = {
  /** The work as one agent message: the hand-off and each report as steps, where it stands, then each approval. */
  message: ConversationMessage;
  /** The hand-off's own step among the message's steps; every other step is a report. */
  handoffStep: string;
  /** Where the hand-off stands. */
  status: DispatchStatus;
  /** Who does the work. */
  role: Dispatch["role"];
  /** What it works on: "Constraints", "Quiet concept", "the app". */
  subject: string;
  /** What the run is doing right now, shown while it works. */
  doing: string;
  /** The steps the run took just before, oldest first, shown under the card while it works. */
  recent: readonly string[];
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
  /** The hand-off's own step, as the coordinator's turns draw a call. */
  handoff: (step: ActivityStep) => ReactNode;
  /** An approval for what the work made, pending or settled. */
  decision: (
    approval: DocumentApproval,
    decide?: (decision: ToolApprovalDecision) => void,
  ) => ReactNode;
};

function Elapsed({ since }: { since: string }) {
  const seconds = Math.floor(useElapsedMs(since) / 1_000);
  return (
    <span className={styles.time}>
      {wording.activity.elapsed(Math.floor(seconds / 60), seconds % 60)}
    </span>
  );
}

/** The activity's one line, by where the hand-off stands. */
function WorkLine({
  status,
  role,
  subject,
  doing,
  steps,
}: Pick<WorkUnitMessageViewProps, "status" | "role" | "subject" | "doing"> & {
  steps: number;
}): ReactNode {
  switch (status.state) {
    case "starting":
      return <ShimmerText>{text.starting}</ShimmerText>;
    case "working":
      return (
        <>
          <ShimmerText key={doing}>{doing}</ShimmerText>{" "}
          <Elapsed since={status.since} />
        </>
      );
    // Nothing moves until the person answers, so no shimmer and no clock running on it.
    case "approval":
      return text.approval;
    case "ready":
      return text.steps(text.done[role](subject), steps);
    case "finished":
    case "failed":
      return text.steps(text.ended(subject), steps);
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
 * Where the work stands: the steps it just took while it works, then the document it filed, or why
 * it stopped.
 */
function WorkResult({
  status,
  recent,
  preview,
  report,
  onOpen,
  watch,
}: {
  status: DispatchStatus;
  recent: readonly string[];
  preview: RunPreview | undefined;
  report: string | undefined;
  onOpen: ((kind: string) => void) | undefined;
  watch: WorkUnitStanding["watch"];
}) {
  if (status.state === "working")
    return (
      <>
        {recent.length === 0 ? null : (
          <ul className={styles.recent} aria-label={text.recent}>
            {recent.map((line, index) => (
              <li key={`${String(index)}:${line}`}>{line}</li>
            ))}
          </ul>
        )}
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
        {text.failed(status.reason)}
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

/** One report the specialist mailed back, by its first line, opening to all of it. */
function ReportStep({ step }: { step: PartTool }) {
  return (
    <Tool part={{ ...step, name: "" }}>
      <ToolHeader label={step.name} statusLabels={{ "output-available": "" }} />
      <ToolOutput
        title={wording.reported}
        render={(value) => <Markdown source={String(value)} />}
      />
    </Tool>
  );
}

export function WorkUnitMessageView({
  message,
  handoffStep,
  status,
  role,
  subject,
  doing,
  recent,
  preview,
  report,
  approvals,
  onOpenDocument,
  watch,
  handoff,
  decision,
}: WorkUnitMessageViewProps) {
  const live = status.state === "starting" || status.state === "working";
  // Done work reads as one thing: its steps open from the header, not from a line that repeats it.
  const done = status.state === "ready" || status.state === "finished";
  // Its steps stay open while the work is in progress and fold once it ends, unless the person chose.
  const [chosen, setChosen] = useState<boolean>();
  const stepsOpen = chosen ?? (live || status.state === "approval");
  const asked = new Map(
    approvals.map((approval) => [approval.approvalId, approval]),
  );
  const approvalOf = (step: ActivityStep) =>
    step.kind === "tool-trace" ? asked.get(step.toolCallId) : undefined;
  const stepCount = message.parts.filter(
    (part) => part.kind === "tool-trace" && !asked.has(part.toolCallId),
  ).length;
  return (
    <ConversationItem itemId={message.id}>
      <Message from="agent" status={message.status}>
        <MessageHeader name={message.author.name} role={message.author.role}>
          {done ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className={styles.steps}
              aria-expanded={stepsOpen}
              onClick={() => setChosen(!stepsOpen)}
            >
              {text.stepsToggle(stepCount)}
            </Button>
          ) : null}
        </MessageHeader>
        <MessageParts
          parts={message.parts}
          streaming={live}
          renderActivity={(steps) => {
            // Decided approvals fold together after the result; each keeps its own quiet line.
            const decided = steps.flatMap((step) => {
              const approval = approvalOf(step);
              return approval === undefined ? [] : [approval];
            });
            if (decided.length === steps.length)
              return decided.map((approval) => (
                <Fragment key={approval.approvalId}>
                  {decision(approval)}
                </Fragment>
              ));
            const content = (
              <ActivityContent
                renderStep={(step) =>
                  step.kind === "tool-trace" &&
                  step.toolCallId !== handoffStep ? (
                    <ReportStep step={step} />
                  ) : (
                    handoff(step)
                  )
                }
              />
            );
            if (done)
              return (
                <Activity
                  steps={steps}
                  open={stepsOpen}
                  onOpenChange={setChosen}
                >
                  {content}
                </Activity>
              );
            return (
              <Activity
                steps={steps}
                streaming={live}
                open={stepsOpen}
                onOpenChange={setChosen}
              >
                <ActivityTrigger
                  label={
                    <WorkLine
                      status={status}
                      role={role}
                      subject={subject}
                      doing={doing}
                      steps={steps.length}
                    />
                  }
                  labels={wording.activity.trigger}
                />
                {content}
              </Activity>
            );
          }}
          renderApproval={(part, decide) => {
            const approval = asked.get(part.toolCallId);
            return approval === undefined
              ? undefined
              : decision(approval, decide);
          }}
          renderBlock={(part) =>
            part.block.type === WORK_RESULT_BLOCK ? (
              <WorkResult
                status={status}
                recent={recent}
                preview={preview}
                report={report}
                onOpen={onOpenDocument}
                watch={watch}
              />
            ) : null
          }
        />
      </Message>
    </ConversationItem>
  );
}

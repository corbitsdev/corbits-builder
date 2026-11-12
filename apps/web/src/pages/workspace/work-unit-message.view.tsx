/**
 * A piece of work as one agent message through MessageParts: the hand-off and
 * the specialist's reports fold into one activity named by what came of it,
 * where it stands is one line, and each approval for what it made is a
 * ToolApproval in the same message that settles to its one quiet line.
 */
import { Fragment, type ReactNode } from "react";
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
  /** The hub refused the hand-off. */
  refused: boolean;
  /** The approvals for what the work made. */
  approvals: readonly DocumentApproval[];
  /** Opens the document the work filed; absent where nothing can open it. */
  onOpenDocument: ((kind: string) => void) | undefined;
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
  refused,
  steps,
}: Pick<
  WorkUnitMessageViewProps,
  "status" | "role" | "subject" | "doing" | "refused"
> & {
  steps: number;
}): ReactNode {
  switch (status.state) {
    case "waiting":
      return text.waiting;
    case "declined":
      return text.declined[status.status];
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
      if (refused) return text.refused;
      return text.steps(text.ended(subject), steps);
  }
}

/**
 * Where the work stands: the steps it just took while it works, then the document it filed, or why
 * it stopped.
 */
function WorkResult({
  status,
  recent,
  onOpen,
}: {
  status: DispatchStatus;
  recent: readonly string[];
  onOpen: ((kind: string) => void) | undefined;
}) {
  if (status.state === "working" && recent.length > 0)
    return (
      <ul className={styles.recent} aria-label={text.recent}>
        {recent.map((line, index) => (
          <li key={`${String(index)}:${line}`}>{line}</li>
        ))}
      </ul>
    );
  if (status.state === "failed")
    return (
      <p className={styles.result} data-state="failed" title={status.reason}>
        {text.failed(status.reason)}
      </p>
    );
  if (status.state !== "ready") return null;
  const ready = text.ready(status.title, status.version);
  return (
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
  refused,
  approvals,
  onOpenDocument,
  handoff,
  decision,
}: WorkUnitMessageViewProps) {
  const live = status.state === "starting" || status.state === "working";
  const asked = new Map(
    approvals.map((approval) => [approval.approvalId, approval]),
  );
  const approvalOf = (step: ActivityStep) =>
    step.kind === "tool-trace" ? asked.get(step.toolCallId) : undefined;
  return (
    <ConversationItem itemId={message.id}>
      <Message from="agent" status={message.status}>
        <MessageHeader name={message.author.name} role={message.author.role} />
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
            return (
              <Activity steps={steps} streaming={live}>
                <ActivityTrigger
                  label={
                    <WorkLine
                      status={status}
                      role={role}
                      subject={subject}
                      doing={doing}
                      refused={refused}
                      steps={steps.length}
                    />
                  }
                  labels={wording.activity.trigger}
                />
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
                onOpen={onOpenDocument}
              />
            ) : null
          }
        />
      </Message>
    </ConversationItem>
  );
}

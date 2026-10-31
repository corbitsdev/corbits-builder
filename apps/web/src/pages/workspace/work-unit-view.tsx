/**
 * A piece of work as one agent message through MessageParts: the hand-off and
 * the specialist's reports fold into one activity named by what came of it,
 * where it stands is one line, and each approval for what it made is a
 * ToolApproval in the same message that settles to its one quiet line.
 */
import { Fragment, useContext, type ReactNode } from "react";
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
  type PartTool,
  type ToolApprovalDecision,
} from "@corbits/react-ui";
import type { AgentActivity } from "@corbits-builder/client";
import { wording } from "../../config.ts";
import { Markdown } from "../../markdown.jsx";
import { activityPhrase } from "./agent-activity.tsx";
import {
  DispatchRoomContext,
  dispatchStatus,
  noteDispatch,
  type Dispatch,
  type DispatchStatus,
} from "./dispatch-card.tsx";
import { useElapsedMs } from "./elapsed.tsx";
import type { DocumentApproval } from "./transcript.tsx";
import {
  WORK_RESULT_BLOCK,
  workSubject,
  workUnitMessage,
  type WorkUnit,
} from "./work-unit.ts";

const text = wording.dispatch;

const sentenceStart = (line: string) =>
  line.charAt(0).toUpperCase() + line.slice(1);

function Elapsed({ since }: { since: string }) {
  const seconds = Math.floor(useElapsedMs(since) / 1_000);
  return (
    <span className="work-unit-time">
      {wording.activity.elapsed(Math.floor(seconds / 60), seconds % 60)}
    </span>
  );
}

/** What the run is doing now, from its own tool events, else what it works on. */
function liveLine(
  dispatch: Dispatch,
  subject: string,
  activity: readonly AgentActivity[],
): string {
  const agent = activity.find((item) =>
    dispatch.runId === undefined
      ? item.role === dispatch.role
      : item.runId === dispatch.runId,
  );
  return agent === undefined || agent.tools.length === 0
    ? text.working(subject)
    : sentenceStart(activityPhrase(agent).phrase);
}

/** The activity's one line, by where the hand-off stands. */
function WorkLine({
  dispatch,
  status,
  subject,
  steps,
  activity,
}: {
  dispatch: Dispatch;
  status: DispatchStatus;
  subject: string;
  steps: number;
  activity: readonly AgentActivity[];
}): ReactNode {
  switch (status.state) {
    case "waiting":
      return text.waiting;
    case "declined":
      return text.declined[status.status];
    case "starting":
      return <ShimmerText>{text.starting}</ShimmerText>;
    case "working": {
      const line = liveLine(dispatch, subject, activity);
      return (
        <>
          <ShimmerText key={line}>{line}</ShimmerText>{" "}
          <Elapsed since={status.since} />
        </>
      );
    }
    case "ready":
      return text.steps(text.done[dispatch.role](subject), steps);
    case "finished":
    case "failed":
      return text.steps(text.ended(subject), steps);
  }
}

/** Where the work stands once it has an outcome: the document it filed, or why it stopped. */
function WorkResult({
  status,
  onOpen,
}: {
  status: DispatchStatus;
  onOpen: ((kind: string) => void) | undefined;
}) {
  if (status.state === "failed")
    return (
      <p className="work-unit-result" data-state="failed" title={status.reason}>
        {text.failed(status.reason)}
      </p>
    );
  if (status.state !== "ready") return null;
  const ready = text.ready(status.title, status.version);
  return (
    <p className="work-unit-result">
      <span className="work-unit-ready" title={ready}>
        {ready}
      </span>
      {onOpen === undefined ? null : (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="work-unit-open"
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

export function WorkUnitView({
  unit,
  renderStep,
  renderDecision,
}: {
  unit: WorkUnit;
  /** The hand-off's own step, as the coordinator's turns draw a call. */
  renderStep: (step: ActivityStep) => ReactNode;
  /** An approval for what the work made, pending or settled. */
  renderDecision: (
    approval: DocumentApproval,
    decide?: (decision: ToolApprovalDecision) => void,
  ) => ReactNode;
}) {
  const room = useContext(DispatchRoomContext);
  const { dispatch } = unit;
  if (room !== null) noteDispatch(room, dispatch);
  const status: DispatchStatus =
    room === null ? { state: "starting" } : dispatchStatus(dispatch, room);
  const message = workUnitMessage(unit, status);
  const subject = workSubject(dispatch, status) ?? text.unnamed;
  const live = status.state === "starting" || status.state === "working";
  const approvals = new Map(
    unit.approvals.map((approval) => [approval.approvalId, approval]),
  );
  const approvalOf = (step: ActivityStep) =>
    step.kind === "tool-trace" ? approvals.get(step.toolCallId) : undefined;
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
                  {renderDecision(approval)}
                </Fragment>
              ));
            return (
              <Activity steps={steps} streaming={live}>
                <ActivityTrigger
                  label={
                    <WorkLine
                      dispatch={dispatch}
                      status={status}
                      subject={subject}
                      steps={steps.length}
                      activity={room?.activity ?? []}
                    />
                  }
                  labels={wording.activity.trigger}
                />
                <ActivityContent
                  renderStep={(step) =>
                    step.kind === "tool-trace" &&
                    step.toolCallId !== dispatch.key ? (
                      <ReportStep step={step} />
                    ) : (
                      renderStep(step)
                    )
                  }
                />
              </Activity>
            );
          }}
          renderApproval={(part, decide) => {
            const approval = approvals.get(part.toolCallId);
            return approval === undefined
              ? undefined
              : renderDecision(approval, decide);
          }}
          renderBlock={(part) =>
            part.block.type === WORK_RESULT_BLOCK ? (
              <WorkResult status={status} onOpen={room?.onOpenDocument} />
            ) : null
          }
        />
      </Message>
    </ConversationItem>
  );
}

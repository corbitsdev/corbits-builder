/**
 * Where one hand-off stands in the room, as the message its work reads as: its status from native
 * run records and filed documents, and what its run is doing from the run's own tool events.
 */
import type { AgentActivity } from "@corbits-builder/client";
import { wording } from "../../config.ts";
import { activityPhrase } from "./agent-activity.tsx";
import {
  dispatchStatus,
  noteDispatch,
  type Dispatch,
  type DispatchRoom,
} from "./dispatch-card.tsx";
import type { WorkUnitStanding } from "./work-unit-message.view.tsx";
import { workSubject, workUnitMessage, type WorkUnit } from "./work-unit.ts";

const text = wording.dispatch;

const sentenceStart = (line: string) =>
  line.charAt(0).toUpperCase() + line.slice(1);

/** What the run is doing now, from its own tool events, else what it works on. */
function liveLine(
  dispatch: Dispatch,
  subject: string,
  activity: readonly AgentActivity[] | undefined,
): string {
  const agent = activity?.find((item) =>
    dispatch.runId === undefined
      ? item.role === dispatch.role
      : item.runId === dispatch.runId,
  );
  return agent === undefined || agent.tools.length === 0
    ? text.working(subject)
    : sentenceStart(activityPhrase(agent).phrase);
}

/** A piece of work as its message shows it, from what the room knows of its hand-off. */
export function workUnitStanding(
  unit: WorkUnit,
  room: DispatchRoom,
): WorkUnitStanding {
  const { dispatch } = unit;
  noteDispatch(room, dispatch);
  const status = dispatchStatus(dispatch, room);
  const subject = workSubject(dispatch, status) ?? text.unnamed;
  return {
    message: workUnitMessage(unit, status),
    handoffStep: dispatch.key,
    status,
    role: dispatch.role,
    subject,
    doing: liveLine(dispatch, subject, room.activity),
    refused: dispatch.refused !== undefined,
    approvals: unit.approvals,
    onOpenDocument: room.onOpenDocument,
  };
}

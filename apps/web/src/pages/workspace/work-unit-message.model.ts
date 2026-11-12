/**
 * Where one hand-off stands in the room, as the message its work reads as: its status from native
 * run records and filed documents, and what its run is doing from the run's own tool events.
 */
import type { AgentActivity } from "@corbits-builder/client";
import { wording } from "../../config.ts";
import { activityPhrase, toolPhrase } from "./agent-activity.tsx";
import {
  dispatchStatus,
  noteDispatch,
  type Dispatch,
  type DispatchRoom,
} from "./dispatch-card.tsx";
import type { WorkUnitStanding } from "./work-unit-message.view.tsx";
import { workSubject, workUnitMessage, type WorkUnit } from "./work-unit.ts";

const text = wording.dispatch;

// The specialists whose work shows as it happens: the designer's draft and the coder's running app.
const WATCH: Partial<Record<Dispatch["role"], string>> = {
  designer: text.watchDraft,
  coder: text.watchApp,
};

const sentenceStart = (line: string) =>
  line.charAt(0).toUpperCase() + line.slice(1);

/**
 * What the run is doing now, from its own tool events, else what it works on, and the steps it took
 * just before, oldest first.
 */
function liveLines(
  dispatch: Dispatch,
  subject: string,
  activity: readonly AgentActivity[] | undefined,
): { doing: string; recent: readonly string[] } {
  const agent = activity?.find((item) =>
    dispatch.runId === undefined
      ? item.role === dispatch.role
      : item.runId === dispatch.runId,
  );
  if (agent === undefined || agent.tools.length === 0)
    return { doing: text.working(subject), recent: [] };
  // A long command's own line is what it does now, so every call it read is a step before it.
  const before =
    agent.command === undefined ? agent.tools.slice(0, -1) : agent.tools;
  return {
    doing: sentenceStart(activityPhrase(agent).phrase),
    recent: before.map((tool) => toolPhrase(tool.name, tool.subject)),
  };
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
  const { doing, recent } = liveLines(dispatch, subject, room.activity);
  const { onWatch } = room;
  const watchLabel = WATCH[dispatch.role];
  return {
    message: workUnitMessage(unit, status),
    handoffStep: dispatch.key,
    status,
    role: dispatch.role,
    subject,
    doing,
    recent,
    refused: dispatch.refused !== undefined,
    approvals: unit.approvals,
    onOpenDocument: room.onOpenDocument,
    watch:
      onWatch === undefined || watchLabel === undefined
        ? undefined
        : { label: watchLabel, open: () => onWatch(dispatch) },
  };
}

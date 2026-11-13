/**
 * Where one hand-off stands in the room, as the step its work reads as: its status from native run
 * records and filed documents, and its steps from the run's own stream.
 */
import type { PartTool } from "@corbits/react-ui";
import { wording } from "../../config.ts";
import {
  dispatchStatus,
  noteDispatch,
  type Dispatch,
  type DispatchRoom,
} from "./dispatch-card.tsx";
import type { WorkUnitStanding } from "./work-unit-step.view.tsx";
import { workPhrase, type WorkUnit } from "./work-unit.ts";

const text = wording.dispatch;

// The specialists whose work shows as it happens: the designer's draft and the coder's running app.
const WATCH: Partial<Record<Dispatch["role"], string>> = {
  designer: text.watchDraft,
  coder: text.watchApp,
};

// A run that ended returned from every call it made, though its stream closed before saying so.
const settled = (step: PartTool): PartTool =>
  step.status === "running"
    ? {
        kind: "tool-trace",
        toolCallId: step.toolCallId,
        name: step.name,
        status: "output-available",
        input: step.input,
      }
    : step;

/** A piece of work as its step shows it, from what the room knows of its hand-off. */
export function workUnitStanding(
  unit: WorkUnit,
  room: DispatchRoom,
): WorkUnitStanding {
  const { dispatch } = unit;
  noteDispatch(room, dispatch);
  const status = dispatchStatus(dispatch, room);
  const done = status.state === "ready" || status.state === "finished";
  const ended = done || status.state === "failed" || status.state === "stopped";
  const steps =
    (dispatch.runId === undefined
      ? undefined
      : room.steps?.get(dispatch.runId)) ?? [];
  const { onWatch, onStop } = room;
  const { runId } = dispatch;
  const role = wording.activity.role[dispatch.role];
  const watchLabel = WATCH[dispatch.role];
  return {
    unitKey: unit.key,
    status,
    label: text.row(role, workPhrase(dispatch, status)),
    steps: ended ? steps.map(settled) : steps,
    preview:
      status.state === "working" && dispatch.runId !== undefined
        ? room.previews?.get(dispatch.runId)
        : undefined,
    instruction: dispatch.instruction,
    report: done ? unit.updates.at(-1)?.text : undefined,
    onOpenDocument: room.onOpenDocument,
    watch:
      onWatch === undefined || watchLabel === undefined
        ? undefined
        : { label: watchLabel, open: () => onWatch(dispatch) },
    stop:
      onStop === undefined ||
      runId === undefined ||
      (status.state !== "working" && status.state !== "approval")
        ? undefined
        : { ask: text.stopAsk(role), confirm: () => onStop(runId) },
  };
}

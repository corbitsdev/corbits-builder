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
import { roleLabel, roleOf } from "./roles.ts";
import { workPhrase, type WorkUnit } from "./work-unit.ts";

const text = wording.dispatch;

// The roles whose work shows as it happens: the running app of one that writes code, and the draft
// of one that designs.
function watchOf(dispatch: Dispatch) {
  const role = roleOf(dispatch.role);
  if (role?.writesCode) return text.watchApp;
  if (role?.designs) return text.watchDraft;
  return undefined;
}

// A run that finished returned from every call it made, though its stream closed before saying so.
// A call with no result in a run that was stopped or failed never returned: it stopped with its run.
const settled = (step: PartTool, finished: boolean): PartTool =>
  step.status === "running"
    ? {
        kind: "tool-trace",
        toolCallId: step.toolCallId,
        name: step.name,
        status: finished ? "output-available" : "output-denied",
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
  const role = roleLabel(dispatch.role);
  const watchLabel = watchOf(dispatch);
  return {
    unitKey: unit.key,
    status,
    label: text.row(role, workPhrase(dispatch, status)),
    steps: ended ? steps.map((step) => settled(step, done)) : steps,
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

/**
 * Where one hand-off stands in the room, as the step its work reads as: its status from native run
 * records and filed documents, and its steps from the run's own stream.
 */
import type { PartTool } from "@corbits/react-ui";
import { isDocumentKind } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import { dispatchStatus, type DispatchRoom } from "./dispatch.ts";
import type { RowPreview, WorkUnitStanding } from "./work-unit-step.view.tsx";
import { roleLabel } from "./roles.ts";
import { workPhrase, type WorkUnit } from "./work-unit.ts";

const text = wording.dispatch;

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

/**
 * What a working run's row shows in its live slot: what its stream says it is producing, else
 * that it is waiting, so the slot is never empty between one model call and the next.
 */
function livePreview(
  runId: string | undefined,
  room: DispatchRoom,
): RowPreview {
  const streamed = runId === undefined ? undefined : room.previews?.get(runId);
  return streamed ?? { kind: "waiting" };
}

/** A piece of work as its step shows it, from what the room knows of its hand-off. */
export function workUnitStanding(
  unit: WorkUnit,
  room: DispatchRoom,
): WorkUnitStanding {
  const { dispatch } = unit;
  const status = dispatchStatus(dispatch, room);
  const done = status.state === "ready" || status.state === "finished";
  const ended =
    done ||
    status.state === "failed" ||
    status.state === "stopped" ||
    status.state === "blocked";
  const steps =
    (dispatch.runId === undefined
      ? undefined
      : room.steps?.get(dispatch.runId)) ?? [];
  const { onStop, onOpenDocument } = room;
  const { runId } = dispatch;
  const role = roleLabel(dispatch.role);
  return {
    unitKey: unit.key,
    status,
    label: workPhrase(dispatch, status),
    steps: ended ? steps.map((step) => settled(step, done)) : steps,
    preview: status.state === "working" ? livePreview(runId, room) : undefined,
    instruction: dispatch.instruction,
    report: done ? unit.updates.at(-1)?.text : undefined,
    // A design or an app is not a document: its row offers it to open, with no summary to show.
    document:
      status.state === "ready" &&
      isDocumentKind(status.kind) &&
      onOpenDocument !== undefined
        ? {
            kind: status.kind,
            title: status.title,
            version: status.version,
            summary: room.summaries?.get(status.kind),
            onOpen: onOpenDocument,
          }
        : undefined,
    onOpenDocument,
    stop:
      onStop === undefined ||
      runId === undefined ||
      (status.state !== "working" && status.state !== "approval")
        ? undefined
        : { ask: text.stopAsk(role), confirm: () => onStop(runId) },
  };
}

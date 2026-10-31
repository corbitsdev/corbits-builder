/**
 * One hand-off and what came of it as one piece of work: the call that
 * started a specialist, the reports that specialist mailed back, and the
 * approvals for what it made. Everything is joined on native facts: a report
 * by its sender's role and time, an approval by the tool that raised it, the
 * arguments that call carried, and the document kinds it names. A report or
 * approval no single hand-off answers stays on its own.
 */
import type {
  ConversationMessage,
  ConversationPart,
  ToolTraceStatus,
} from "@corbits/react-ui";
import { PACKAGE_INSTALL_TOOL } from "@corbits-builder/schemas/package-install";
import { wording } from "../../config.ts";
import { toolPhrase } from "./agent-activity.tsx";
import { APPROVES_KINDS } from "./collaboration.ts";
import { approvalToolPart } from "./conversation-parts.ts";
import {
  DISPATCH_TOOLS,
  subjectOf,
  targetKind,
  type Dispatch,
  type DispatchStatus,
} from "./dispatch-card.tsx";
import { summaryLine, type SpecialistUpdate } from "./specialist-updates.tsx";
import type { DocumentApproval, PlacedDispatch } from "./transcript.tsx";

export type WorkUnit = {
  readonly key: string;
  /** When the hand-off was made; a call in the live turn has no time yet, so it is last. */
  readonly startedAt: number;
  /** Its latest report or approval, where it stands in the thread. */
  readonly at: number;
  readonly dispatch: Dispatch;
  readonly updates: readonly SpecialistUpdate[];
  readonly approvals: readonly DocumentApproval[];
};

/** The block part carrying where the hand-off stands, as `DispatchStatus`. */
export const WORK_RESULT_BLOCK = "work-result";

const instructionOf = (approval: DocumentApproval) =>
  approval.instruction?.trim() === "" ? undefined : approval.instruction;

/**
 * The hand-offs with the reports and approvals each one answers, and those
 * that answer none. Mail names only its sender's role, so hand-offs made
 * together to one role, such as one designer per concept, leave that role's
 * reports and asks on their own rather than guessed.
 */
export function workUnits(
  handoffs: readonly PlacedDispatch[],
  updates: readonly SpecialistUpdate[],
  approvals: readonly DocumentApproval[],
): {
  units: WorkUnit[];
  updates: SpecialistUpdate[];
  approvals: DocumentApproval[];
} {
  const placed = [...handoffs].sort((left, right) => left.at - right.at);
  const started = placed.filter(
    ({ dispatch }) => dispatch.refused === undefined,
  );
  const latest = (
    at: number,
    belongs: (dispatch: Dispatch) => boolean,
  ): Dispatch | undefined => {
    const before = started.filter(
      (handoff) => handoff.at <= at && belongs(handoff.dispatch),
    );
    const last = before.at(-1);
    if (last === undefined) return undefined;
    return before.filter((handoff) => handoff.at === last.at).length === 1
      ? last.dispatch
      : undefined;
  };

  // A hand-off that asks first is answered by the ask its own call raised: the same tool and
  // instruction, nearest in time, one ask per call, and only when that call started one run.
  const gated = new Map<string, DocumentApproval>();
  const gateOf = new Map<DocumentApproval, Dispatch>();
  for (const approval of approvals) {
    const tool = approval.toolName;
    if (tool === undefined || !DISPATCH_TOOLS.has(tool)) continue;
    const at = approval.at;
    if (at === undefined) continue;
    const calls = placed.filter(
      ({ dispatch }) =>
        dispatch.tool === tool &&
        dispatch.instruction === instructionOf(approval) &&
        !gated.has(dispatch.call),
    );
    const nearest = calls.sort(
      (left, right) => Math.abs(left.at - at) - Math.abs(right.at - at),
    )[0];
    if (nearest === undefined) continue;
    gated.set(nearest.dispatch.call, approval);
    const runs = placed.filter(
      ({ dispatch }) => dispatch.call === nearest.dispatch.call,
    );
    if (runs.length === 1) gateOf.set(approval, nearest.dispatch);
  }

  const answers = (approval: DocumentApproval): Dispatch | undefined => {
    const tool = approval.toolName;
    if (tool === undefined) return undefined;
    if (DISPATCH_TOOLS.has(tool)) return gateOf.get(approval);
    const at = approval.at;
    if (at === undefined) return undefined;
    // The coder's own run asks to install packages.
    if (tool === PACKAGE_INSTALL_TOOL)
      return latest(at, (dispatch) => dispatch.role === "coder");
    const kinds = approval.kinds;
    if (tool !== APPROVES_KINDS || kinds === undefined) return undefined;
    return latest(at, (dispatch) => {
      const kind = targetKind(dispatch);
      return kind !== undefined && kinds.includes(kind);
    });
  };

  const members = new Map<
    string,
    { updates: SpecialistUpdate[]; approvals: DocumentApproval[] }
  >(
    placed.map(({ dispatch }) => [
      dispatch.key,
      { updates: [], approvals: [] },
    ]),
  );
  const loneUpdates: SpecialistUpdate[] = [];
  const loneApprovals: DocumentApproval[] = [];
  for (const update of updates) {
    const dispatch = latest(update.at, (item) => item.role === update.sender);
    const unit = dispatch === undefined ? undefined : members.get(dispatch.key);
    if (unit === undefined) loneUpdates.push(update);
    else unit.updates.push(update);
  }
  for (const approval of approvals) {
    const dispatch = answers(approval);
    const unit = dispatch === undefined ? undefined : members.get(dispatch.key);
    if (unit === undefined) loneApprovals.push(approval);
    else unit.approvals.push(approval);
  }

  const units = placed.map(({ at, dispatch }): WorkUnit => {
    const unit = members.get(dispatch.key) ?? { updates: [], approvals: [] };
    return {
      key: dispatch.key,
      startedAt: at,
      at: Math.max(
        at,
        ...unit.updates.map((update) => update.at),
        ...unit.approvals.map((approval) => approval.at ?? at),
      ),
      dispatch,
      updates: unit.updates,
      approvals: unit.approvals,
    };
  });
  return { units, updates: loneUpdates, approvals: loneApprovals };
}

const CALL_STATUS: Record<DispatchStatus["state"], ToolTraceStatus> = {
  waiting: "pending",
  declined: "output-denied",
  starting: "pending",
  working: "running",
  ready: "output-available",
  finished: "output-available",
  failed: "error",
};

/** What a hand-off works on, as its message names it: "Approaches", "Quiet concept", "the app". */
export function workSubject(
  dispatch: Dispatch,
  status: DispatchStatus,
): string | undefined {
  // A run named by no call is named by the document it filed, once it has.
  return (
    subjectOf(dispatch) ??
    (status.state === "ready" ? wording.documentTab[status.kind] : undefined)
  );
}

/**
 * A piece of work as one agent message: the specialist and what it works on
 * as its header, the hand-off and each report as steps, where it stands as a
 * result block, then each approval as a tool part carrying its record.
 */
export function workUnitMessage(
  unit: WorkUnit,
  status: DispatchStatus,
): ConversationMessage {
  const { dispatch } = unit;
  const subject = workSubject(dispatch, status);
  const started =
    !dispatch.pending &&
    status.state !== "waiting" &&
    status.state !== "declined";
  const handoff = wording.activity.handoff[dispatch.tool];
  const parts: ConversationPart[] = [
    {
      kind: "tool-trace",
      toolCallId: dispatch.key,
      name:
        started && handoff !== undefined
          ? handoff(subject)
          : toolPhrase(dispatch.tool, undefined),
      status: CALL_STATUS[status.state],
      ...(dispatch.instruction === undefined
        ? {}
        : { input: dispatch.instruction }),
    },
    ...unit.updates.map((update): ConversationPart => ({
      kind: "tool-trace",
      toolCallId: `${dispatch.key}:report:${String(update.at)}`,
      name: summaryLine(update.text),
      status: "output-available",
      output: update.text,
    })),
    { kind: "block", block: { type: WORK_RESULT_BLOCK, data: status } },
    ...unit.approvals.map((approval): ConversationPart => ({
      ...approvalToolPart(approval.approvalId, approval.outcome),
      input: approval,
    })),
  ];
  // A call in the live turn is being made now.
  const at = Number.isFinite(unit.startedAt) ? unit.startedAt : Date.now();
  return {
    id: `work:${unit.key}`,
    author: {
      id: dispatch.role,
      kind: "agent",
      name: wording.activity.role[dispatch.role],
      ...(subject === undefined ? {} : { role: subject }),
    },
    at: new Date(at).toISOString(),
    status:
      status.state === "starting" || status.state === "working"
        ? "streaming"
        : "sent",
    parts,
  };
}

/**
 * One hand-off and what came of it as one piece of work: the call that
 * started a specialist, the reports that specialist mailed back, and the
 * approvals for what it made. Everything is joined on native facts: a report
 * by its sender's role and time, a package install by the coder at work when it
 * was raised. A report or approval no single hand-off answers stays on its own.
 */
import { PACKAGE_INSTALL_TOOL } from "@corbits-builder/schemas/package-install";
import { wording } from "../../config.ts";
import {
  subjectOf,
  type Dispatch,
  type DispatchStatus,
} from "./dispatch-card.tsx";
import type { SpecialistUpdate } from "./specialist-updates.ts";
import type { DocumentApproval, PlacedDispatch } from "./transcript.tsx";

export type WorkUnit = {
  readonly key: string;
  /** Its latest report or approval, where it stands in the thread. */
  readonly at: number;
  readonly dispatch: Dispatch;
  readonly updates: readonly SpecialistUpdate[];
  readonly approvals: readonly DocumentApproval[];
};

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
  // A filed thing's card stands for the run that filed it, placed when it filed: the report that
  // run mails just after belongs on that card, not as a second row naming the same specialist.
  const latest = (
    at: number,
    belongs: (dispatch: Dispatch) => boolean,
  ): Dispatch | undefined => {
    const before = placed.filter(
      (handoff) => handoff.at <= at && belongs(handoff.dispatch),
    );
    const last = before.at(-1);
    if (last === undefined) return undefined;
    return before.filter((handoff) => handoff.at === last.at).length === 1
      ? last.dispatch
      : undefined;
  };

  // The coder's own run asks to install packages.
  const answers = (approval: DocumentApproval): Dispatch | undefined =>
    approval.toolName === PACKAGE_INSTALL_TOOL && approval.at !== undefined
      ? latest(approval.at, (dispatch) => dispatch.role === "coder")
      : undefined;

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

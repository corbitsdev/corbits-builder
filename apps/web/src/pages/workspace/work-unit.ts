/**
 * One hand-off and what came of it as one piece of work: the call that
 * started a specialist and the reports that specialist mailed back, joined by
 * its sender's role and time. A report no single hand-off answers stays on its
 * own.
 */
import { isDocumentKind } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import type { Dispatch, DispatchStatus } from "./dispatch-card.tsx";
import { roleOf } from "./roles.ts";
import type { SpecialistUpdate } from "./specialist-updates.ts";
import type { PlacedDispatch } from "./transcript.tsx";

const text = wording.dispatch;

export type WorkUnit = {
  readonly key: string;
  /** Its latest report, where it stands in the thread. */
  readonly at: number;
  readonly dispatch: Dispatch;
  readonly updates: readonly SpecialistUpdate[];
};

/**
 * The hand-offs with the reports each one answers, and those that answer
 * none. Mail names only its sender's role, so hand-offs made together to one
 * role, such as one designer per concept, leave that role's reports on their
 * own rather than guessed.
 */
export function workUnits(
  handoffs: readonly PlacedDispatch[],
  updates: readonly SpecialistUpdate[],
): { units: WorkUnit[]; updates: SpecialistUpdate[] } {
  const placed = [...handoffs].sort((left, right) => left.at - right.at);
  // A run's report answers the latest hand-off to its role made before it, when only one was.
  const latest = (update: SpecialistUpdate): Dispatch | undefined => {
    const before = placed.filter(
      (handoff) =>
        handoff.at <= update.at && handoff.dispatch.role === update.sender,
    );
    const last = before.at(-1);
    if (last === undefined) return undefined;
    return before.filter((handoff) => handoff.at === last.at).length === 1
      ? last.dispatch
      : undefined;
  };

  const members = new Map<string, SpecialistUpdate[]>(
    placed.map(({ dispatch }) => [dispatch.key, []]),
  );
  const loneUpdates: SpecialistUpdate[] = [];
  for (const update of updates) {
    const dispatch = latest(update);
    const unit = dispatch === undefined ? undefined : members.get(dispatch.key);
    if (unit === undefined) loneUpdates.push(update);
    else unit.push(update);
  }

  const units = placed.map(({ at, dispatch }): WorkUnit => {
    const answers = members.get(dispatch.key) ?? [];
    return {
      key: dispatch.key,
      at: Math.max(at, ...answers.map((update) => update.at)),
      dispatch,
      updates: answers,
    };
  });
  return { units, updates: loneUpdates };
}

/**
 * What a hand-off does, from the action it started: "Building the code", then "Built the code". A
 * run started by no call in view, or by an action with no words of its own, reads as its role says.
 */
export function workPhrase(dispatch: Dispatch, status: DispatchStatus): string {
  const done = status.state === "ready" || status.state === "finished";
  const phrase = text.action[dispatch.action ?? ""];
  if (phrase === undefined) {
    const own = roleOf(dispatch.role)?.status ?? {
      working: text.working,
      done: text.done,
    };
    return done ? own.done : own.working;
  }
  // A document the run filed names it once the call did not; a design or an app names nothing.
  const kind =
    dispatch.kind ??
    (status.state === "ready" && isDocumentKind(status.kind)
      ? status.kind
      : undefined);
  const thing =
    dispatch.concept ??
    (kind === undefined
      ? undefined
      : (wording.documentTab[kind] ?? kind.replaceAll("_", " ")).toLowerCase());
  return done ? phrase.done(thing) : phrase.working(thing);
}

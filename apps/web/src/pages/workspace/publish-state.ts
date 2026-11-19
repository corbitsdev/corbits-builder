/**
 * Where publishing the project's app stands. It is worked out from the hub's records only, never
 * from what an agent wrote: the saved app, the installed publish plans and their take-down actions,
 * the latest check records, the release the target recorded, what the target holds that costs
 * money, the person's go-ahead to take it down, the publishing runs, the open question, the
 * project's plan, whether anything is at work on the project, when work last moved on, the
 * person's press of Publish or Take it down, and the link to keep the app.
 */
import { parsed } from "@corbits-builder/plugin";
import {
  PublishHolding,
  PublishKeep,
  PublishRelease,
  PublishTakeDown,
  recordedFor,
  takeDownStands,
} from "@corbits-builder/plugin/publish";
import { type } from "arktype";
import {
  heldFacts,
  type CheckRecord,
  type ProjectRun,
} from "@corbits-builder/schemas/artifact";

/** What the hub has recorded that says where publishing stands. */
export type PublishRecords = {
  savedApp: boolean;
  /** The ending facts of the installed ready-made plans in the publish group. */
  ends: readonly string[];
  /** The latest record of each check of the project. */
  checks: readonly Pick<
    CheckRecord,
    "result" | "current" | "returns" | "createdAt"
  >[];
  /** The project's publish.release value as stored: null or undefined while there is none. */
  release: unknown;
  /** The project's publish.holding value as stored: null or undefined while nothing is held. */
  holding: unknown;
  /** The project's publish.take-down value as stored: the person's go-ahead to take down, or null. */
  takeDown: unknown;
  /** The take-down action of each installed publish plan that declares one. */
  takeDowns: readonly TakeDownAction[];
  /** The coordinator's runs of actions of plugins in the publish group. */
  runs: readonly Pick<
    ProjectRun,
    "plugin" | "action" | "status" | "startedAt" | "endedAt" | "blocked"
  >[];
  /** An open question's screen belongs to a plugin in the publish group. */
  asking: boolean;
  /** The handles of the installed ready-made plans in the publish group. */
  plans: readonly string[];
  /** The project's plan as the hub works it out, top-level entries only; plan names a plan's group. */
  plan: readonly { plan?: string | undefined; state: string }[];
  /**
   * Something is at work on the project: the coordinator is mid-turn, the person's message is on
   * its way to it, or a run of any plugin is at work.
   */
  working: boolean;
  /**
   * What the person pressed (Publish or Take it down) or answered in a publishing question, while
   * the coordinator has not taken it up yet; null when nothing is waiting.
   */
  pressed: "publish" | "takeDown" | null;
  /**
   * When the person last pressed Publish or Take it down, or answered a publishing question with a
   * go-ahead, in milliseconds since the epoch by the hub's clock as this page saw it; null before.
   */
  acted: number | null;
  /** When the latest run of any plugin on the project ended, in milliseconds since the epoch; null before. */
  ranUntil: number | null;
  /** The project's publish.keep value as stored: the link to keep an app published without an account. */
  keep: unknown;
  /**
   * The current time by the hub's clock, in milliseconds since the epoch, like every other time
   * here. A browser clock that runs ahead or behind would cut short or stretch the hand-off.
   */
  now: number;
};

// A ready-made plan's group still has work ahead in these states. Done, skipped, cancelled and
// failed are end states.
const AHEAD = new Set(["not_started", "waiting", "running", "needs_you"]);
// A failed step ends the group for now, but not the publish: what the step needs, such as a change
// to the app, is often worked on next.
const UNFINISHED = new Set([...AHEAD, "failed"]);

/**
 * How long the project still counts as busy after work last moved on. In the owner's records the
 * coordinator took its next step at most about 7 s after a run ended or a go-ahead was given, and
 * this page can learn of a run's end up to a poll later. After this, nothing more starts on its own.
 */
export const HAND_OFF_MS = 20_000;

/** The plugin action that takes down what a publish plan published. */
type TakeDownAction = { plugin: string; action: string };

/** Where publishing stands, with what each state shows. */
export type PublishState =
  | { state: "unpublished" }
  /**
   * A publish is under way. Either a run is at work on it, or the project is busy while the publish
   * waits, for example for a change the app needs before it can go out or for the coordinator to
   * take its next step.
   */
  | { state: "publishing" }
  /** A publish was started and has work ahead, but nothing is at work and nothing is asked. */
  | { state: "stalled" }
  | { state: "needsYou" }
  /** The recorded release is of the saved app; nothing asks the target if it still serves it. */
  | { state: "published"; url: string; at: string }
  | { state: "changes"; url: string; at: string }
  /** reason is what the publisher said stopped it, if it said anything. */
  | { state: "failed"; reason: string | undefined }
  /** A run of a publish plan's take-down action is at work, or the person asked for one not yet done. */
  | { state: "takingDown" }
  /**
   * The latest take-down failed or was blocked, and what it was meant to remove is still recorded.
   * released: what is left includes the release. The person may have removed it at the target
   * themselves, for example by cancelling the server, and then no take-down can reach it.
   */
  | { state: "takeDownFailed"; reason: string | undefined; released: boolean };

/**
 * The link to keep an app that a target put on a temporary account at place. It shows while the
 * link is recorded, whatever else publishing is doing. passed: the deadline went by, and the
 * records cannot tell whether the person kept the app or it was removed.
 */
export type PublishKeepNotice = { link: string; place: string } & (
  | { passed: false; minutesLeft: number }
  | { passed: true }
);

/** What a target holds for the project that costs money, as the person reads it. */
export type PublishHoldingNotice = {
  place: string;
  since: string;
  costs: string | undefined;
};

/**
 * Where publishing stands, the keep link and the holding shown over it while each is recorded, and
 * whether the person can ask to take down what is published or held.
 */
export type Publishing = {
  state: PublishState;
  keep: PublishKeepNotice | null;
  holding: PublishHoldingNotice | null;
  takeDown: boolean;
};

// The states that offer a take-down. None does while work is under way or the person is asked
// something, and a failed take-down has its own way to try again.
const OFFERS_TAKE_DOWN = new Set<PublishState["state"]>([
  "published",
  "changes",
  "failed",
  "stalled",
  "unpublished",
]);

/** A publishing run is at work: started and not yet ended. */
export const atWork = (run: Pick<ProjectRun, "status">) =>
  run.status === "deployed" || run.status === "running";

/**
 * Where publishing stands; null while there is no saved app to publish or nowhere to publish it.
 * The first row that matches gives the state:
 *
 * | The records say                                                                         | State          |
 * | --------------------------------------------------------------------------------------- | -------------- |
 * | A publishing question is open                                                           | needsYou       |
 * | A run of a take-down action is at work                                                  | takingDown     |
 * | A publishing run is at work                                                             | publishing     |
 * | Take it down was pressed, not yet taken up                                              | takingDown     |
 * | Publish was pressed or a publishing question answered, not yet taken up                 | publishing     |
 * | The latest publishing run is a take-down that failed, and what it removes is recorded   | takeDownFailed |
 * | A take-down is asked for, and the project is busy                                       | takingDown     |
 * | A publish is asked for, and the project is busy                                         | publishing     |
 * | A release is recorded and a publish plan's ending fact holds                            | published      |
 * | The latest publishing run recorded a release, then failed or was blocked                | published      |
 * | The latest publishing run failed or was blocked after the latest release                | failed         |
 * | A release is recorded, and it is behind or no publish plan has work ahead               | changes        |
 * | A publish plan has work ahead, and no take-down is done                                 | stalled        |
 * | Otherwise                                                                               | unpublished    |
 *
 * The project is busy while anything is at work on it, and for HAND_OFF_MS (20 s) after work last
 * moved on. Work moves on when a run of any plugin on the project ends, when the person presses
 * Publish or Take it down, and when they answer a publishing question with a go-ahead. A publish or
 * a take-down is a chain of hand-offs. Between one step ending and the coordinator taking up the
 * next, nothing is at work and nothing is asked. That window is the only rule that reads the
 * clock. Once it passes with nothing at work, the tab shows what the records say.
 *
 * A take-down is asked for while publish.take-down names a target and every release and holding
 * recorded for that target is the one the person agreed to. The target's removableCheck passes on
 * the same rule. Keep it records null, and the request ends when a removal clears what it covered
 * or a newer release is recorded.
 *
 * A publish is asked for while a publish plan is unfinished, the release is not behind, no
 * take-down is done, and no publish plan's ending fact holds for the recorded release. An
 * unfinished plan, perhaps for another target, does not count while the app is published and
 * live. A publish plan is unfinished while its group has work ahead or a failed step, because the
 * coordinator often works through a blocked or failed step next.
 *
 * The release is behind once a check recorded after the release went out finds that a publish
 * plan's ending fact no longer holds, and no publishing run has started since. Then the app was
 * published and a newer version saved. That is not a publish under way, whatever else is at work.
 *
 * A take-down run is a run of the action a publish plan names as its takeDown. A failed take-down
 * is never a failed publish. A take-down is done while the latest publishing run is a take-down
 * that completed and no release was recorded after it ended. The plan it leaves unfinished and the
 * coordinator's turn reporting on it are not a publish under way, so once the run ends the tab
 * shows what is left. Pressing Publish, answering a publishing question or starting a publishing
 * run after that shows a publish under way through the rows above, and a run started then becomes
 * the latest.
 *
 * The keep link is not a state. While publish.keep is recorded it shows over whichever state
 * applies, because a person who misses its deadline loses their app. The holding is not a state
 * either. While publish.holding is recorded it shows over every state, because it costs money
 * whatever else is true.
 *
 * A take-down is offered when a release or a holding is recorded, a publish plan declares a
 * takeDown action for its target, and the state is not work under way, a question or a failed
 * take-down. When both are recorded, the holding's target is the one that counts. A keep link with
 * nothing held means the app is not the person's yet and no take-down can reach it, so none is
 * offered. A holding costs money, so a keep link, perhaps from another target, never hides the way
 * to take the holding down.
 */
export function publishState(records: PublishRecords): Publishing | null {
  if (!records.savedApp || records.ends.length === 0) return null;
  const recorded: Recorded = {
    release: parsed(PublishRelease(records.release)),
    holding: parsed(PublishHolding(records.holding)),
  };
  const { release, holding } = recorded;
  const state = standing(records, recorded);
  const keep = keepNotice(records);
  const target = holding?.target ?? release?.target;
  return {
    state,
    keep,
    holding:
      holding === undefined
        ? null
        : { place: holding.place, since: holding.since, costs: holding.costs },
    takeDown:
      (holding !== undefined || keep === null) &&
      OFFERS_TAKE_DOWN.has(state.state) &&
      records.takeDowns.some(({ plugin }) => plugin === target),
  };
}

// The release and the holding as recorded, each undefined while there is none.
type Recorded = {
  release: PublishRelease | undefined;
  holding: PublishHolding | undefined;
};

// Whether a run is of an action a publish plan takes down with.
const removes = (
  records: PublishRecords,
  run: Pick<ProjectRun, "plugin" | "action">,
) =>
  records.takeDowns.some(
    ({ plugin, action }) => plugin === run.plugin && action === run.action,
  );

// Whether target still has a release or a holding recorded that a take-down of it would remove.
const stillRecorded = ({ release, holding }: Recorded, target: string) =>
  Object.keys(recordedFor(target, release, holding)).length > 0;

// What the latest publishing run means when it was a publish that failed or was blocked. If it
// recorded the release before it stopped, the app is published: the run may have stopped at an
// address slow to start answering, before its check ran. If it stopped after the latest release
// went out, the publish failed, and that is what the person last saw. If it is older than the
// release, it says nothing.
function outcomeOf(
  latest: Pick<ProjectRun, "startedAt" | "endedAt">,
  release: PublishRelease | undefined,
): "published" | "failed" | null {
  const started = Date.parse(latest.startedAt);
  const ended = endOf(latest);
  if (release === undefined) return "failed";
  const at = Date.parse(release.at);
  if (at >= started && at <= ended) return "published";
  return ended > at ? "failed" : null;
}

type Run = PublishRecords["runs"][number];

const endOf = (run: Pick<Run, "startedAt" | "endedAt">) =>
  Date.parse(run.endedAt ?? run.startedAt);

// The publishing run started last, which says how the latest publish or take-down went.
const latestOf = (runs: readonly Run[]): Run | undefined =>
  [...runs].sort(
    (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
  )[0];

const stopped = (run: Run) =>
  run.status === "failed" || run.blocked !== undefined;

// Anything is at work on the project, or work moved on a moment ago and its next step is on its
// way to the coordinator.
const busy = (records: PublishRecords) =>
  records.working || records.now < movedAt(records) + HAND_OFF_MS;

// When work on the project last moved on: a run ended, or the person pressed or answered.
const movedAt = ({ acted, ranUntil }: PublishRecords) =>
  Math.max(acted ?? -Infinity, ranUntil ?? -Infinity);

// The person's go-ahead to take down still applies to the target it names: the removal is not done.
function askedToTakeDown(records: PublishRecords, recorded: Recorded) {
  const asked = parsed(PublishTakeDown(records.takeDown));
  return (
    asked !== undefined &&
    takeDownStands(asked, asked.target, recorded.release, recorded.holding)
  );
}

// A completed take-down leaves the publish plan unfinished and its ending fact gone with the
// release, while the coordinator is still telling the person. None of that is a publish.
const tookDown = (
  records: PublishRecords,
  latest: Run | undefined,
  release: PublishRelease | undefined,
) =>
  latest !== undefined &&
  removes(records, latest) &&
  latest.status === "completed" &&
  latest.blocked === undefined &&
  (release === undefined || Date.parse(release.at) <= endOf(latest));

// Whether a publish plan's group in the project's plan is in one of states.
const planIn = (records: PublishRecords, states: ReadonlySet<string>) =>
  records.plan.some(
    (entry) =>
      entry.plan !== undefined &&
      records.plans.includes(entry.plan) &&
      states.has(entry.state),
  );

function standing(records: PublishRecords, recorded: Recorded): PublishState {
  const { release } = recorded;
  if (records.asking) return { state: "needsYou" };
  const running = records.runs.filter(atWork);
  if (running.some((run) => removes(records, run)))
    return { state: "takingDown" };
  if (running.length > 0) return { state: "publishing" };
  if (records.pressed === "takeDown") return { state: "takingDown" };
  if (records.pressed === "publish") return { state: "publishing" };
  const latest = latestOf(records.runs);
  const latestRemoves = latest !== undefined && removes(records, latest);
  if (
    latest !== undefined &&
    latestRemoves &&
    stopped(latest) &&
    stillRecorded(recorded, latest.plugin)
  )
    return {
      state: "takeDownFailed",
      reason: latest.blocked?.reason,
      released: release?.target === latest.plugin,
    };
  if (busy(records) && askedToTakeDown(records, recorded))
    return { state: "takingDown" };
  const done = tookDown(records, latest, release);
  const held = heldFacts(records.checks);
  const behind = release !== undefined && isBehind(records, release.at, held);
  const live =
    release !== undefined && records.ends.some((fact) => held.has(fact));
  if (busy(records) && !done && !behind && !live && planIn(records, UNFINISHED))
    return { state: "publishing" };
  const outcome =
    latest !== undefined && stopped(latest) && !latestRemoves
      ? outcomeOf(latest, release)
      : null;
  const planAhead = !done && planIn(records, AHEAD);
  if (live) return { state: "published", url: release.url, at: release.at };
  if (release !== undefined && outcome === "published")
    return { state: "published", url: release.url, at: release.at };
  if (outcome === "failed")
    return { state: "failed", reason: latest?.blocked?.reason };
  if (release !== undefined && (behind || !planAhead))
    return { state: "changes", url: release.url, at: release.at };
  if (planAhead) return { state: "stalled" };
  return { state: "unpublished" };
}

/**
 * The next time, in milliseconds since the epoch, at which the clock alone changes what
 * publishState shows for these records: the keep link's minutes left tick down or its deadline
 * passes, or the project stops counting as busy. null when nothing depends on the clock.
 */
export function changesAt(records: PublishRecords): number | null {
  const times: number[] = [];
  const settles = movedAt(records) + HAND_OFF_MS;
  if (settles > records.now) times.push(settles);
  const keep = PublishKeep(records.keep);
  if (!(keep instanceof type.errors)) {
    const left = Date.parse(keep.until) - records.now;
    if (left > 0) times.push(records.now + (left % 60_000) + 1);
  }
  return times.length === 0 ? null : Math.min(...times);
}

// Whether a check recorded since the release went out at `at` finds an ending fact no longer holds,
// and no publishing run has started since. A check from before the release is about an earlier one.
function isBehind(
  records: PublishRecords,
  at: string,
  held: ReadonlySet<string>,
) {
  const out = Date.parse(at);
  const lapsed = records.checks.some(
    (check) =>
      Date.parse(check.createdAt) >= out &&
      check.returns.some(
        (fact) => records.ends.includes(fact) && !held.has(fact),
      ),
  );
  return (
    lapsed &&
    !records.runs.some(
      (run) => !removes(records, run) && Date.parse(run.startedAt) > out,
    )
  );
}

function keepNotice(records: PublishRecords): PublishKeepNotice | null {
  const checked = PublishKeep(records.keep);
  if (checked instanceof type.errors) return null;
  const { link, place } = checked;
  const left = Date.parse(checked.until) - records.now;
  if (left <= 0) return { link, place, passed: true };
  return { link, place, passed: false, minutesLeft: Math.floor(left / 60_000) };
}

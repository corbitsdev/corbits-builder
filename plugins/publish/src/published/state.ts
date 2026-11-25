// Where publishing the project's app stands, worked out in the hub from the project's records alone.
import {
  parsed,
  type ProjectRead,
  type RunRead,
} from "@corbits-builder/plugin";
import {
  PUBLISH_HOLDING,
  PUBLISH_KEEP,
  PUBLISH_RELEASE,
  PUBLISH_TAKE_DOWN,
  PublishHolding,
  PublishKeep,
  PublishRelease,
  PublishTakeDown,
  recordedFor,
  takeDownStands,
} from "@corbits-builder/publish-contract";
import { PUBLISH_ASKED, PUBLISH_GROUP, PublishAsked } from "../go-ahead.ts";

/**
 * How long the project still counts as busy after work last moved on: a run ended, or the person
 * asked. A publish or a take-down is a chain of hand-offs, and between one step ending and the
 * coordinator taking up the next, nothing is at work. Without this window the tab would flash a
 * stalled or finished state at each hand-off. The coordinator takes its next step within seconds.
 */
export const HAND_OFF_MS = 20_000;

/**
 * How long an ask holds while the coordinator has not started a turn since. The coordinator is told
 * at the press and starts its turn within seconds, so after a minute the ask did not reach it. Some
 * other run parked at work must not hold the ask, and the button that sends it again, forever.
 */
export const UNTAKEN_MS = 60_000;

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
  /** The coordinator asks the person something in the conversation that publishing waits on. */
  | { state: "needsYou" }
  /** The recorded release is of the saved app; nothing asks the target if it still serves it. */
  | { state: "published"; url: string; at: string }
  | { state: "changes"; url: string; at: string }
  /** reason is what the target said stopped it, if it said anything. */
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
 * link is recorded, whatever else publishing is doing. passed: the deadline went by, and the records
 * cannot tell whether the person kept the app or it was removed. The link works like a password, so
 * the room never saves this state.
 */
export type PublishKeepNotice = { link: string; place: string } & (
  | { passed: false; minutesLeft: number }
  | { passed: true }
);

/**
 * Where publishing stands, the keep link and the holding shown over it while each is recorded, and
 * whether the person can ask to take down what is published or held.
 */
export type Publishing = {
  state: PublishState;
  keep: PublishKeepNotice | null;
  holding: PublishHolding | null;
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

/** A run is at work: started and not yet ended. */
const atWork = (run: Pick<RunRead, "status">) =>
  run.status === "deployed" || run.status === "running";

// What the hub read that publishing turns on, from the project as a screen reads it.
type Records = {
  project: ProjectRead;
  // The handles of the installed publish plans, their ending facts and their take-down actions.
  plans: readonly string[];
  ends: readonly string[];
  takeDowns: readonly { plugin: string; action: string }[];
  // The plugins the publish plans name, which is every target, and their runs.
  targets: ReadonlySet<string>;
  runs: readonly RunRead[];
  release: PublishRelease | undefined;
  holding: PublishHolding | undefined;
  keep: PublishKeep | undefined;
  takeDownAsked: PublishTakeDown | undefined;
  // The person's latest ask, while it still decides what shows; and when they last asked.
  pressed: PublishAsked["kind"] | null;
  acted: number | null;
  // When the latest run of any plugin on the project ended; null before any did.
  ranUntil: number | null;
  // Something is at work on the project: the coordinator is mid-turn or any run is at work.
  working: boolean;
};

function recordsOf(project: ProjectRead): Records | null {
  const offered = project.plans(PUBLISH_GROUP);
  const ends = offered.flatMap(({ ends }) =>
    ends === undefined ? [] : [ends],
  );
  if (project.app.version === undefined || ends.length === 0) return null;
  const takeDowns = offered.flatMap(({ takeDown }) =>
    takeDown === undefined ? [] : [takeDown],
  );
  const targets = new Set([
    ...offered.flatMap(({ plugins }) => plugins),
    ...takeDowns.map(({ plugin }) => plugin),
  ]);
  const runs = project.runs.filter((run) => targets.has(run.plugin));
  const working = project.coordinator.working || project.runs.some(atWork);
  const asked = parsed(PublishAsked(project.value(PUBLISH_ASKED)));
  const ended = project.runs.flatMap(({ endedAt }) =>
    endedAt === undefined ? [] : [Date.parse(endedAt)],
  );
  const acted = asked === undefined ? null : Date.parse(asked.at);
  return {
    project,
    plans: offered.map(({ handle }) => handle),
    ends,
    takeDowns,
    targets,
    runs,
    release: parsed(PublishRelease(project.value(PUBLISH_RELEASE))),
    holding: parsed(PublishHolding(project.value(PUBLISH_HOLDING))),
    keep: parsed(PublishKeep(project.value(PUBLISH_KEEP))),
    takeDownAsked: parsed(PublishTakeDown(project.value(PUBLISH_TAKE_DOWN))),
    pressed:
      asked !== undefined &&
      acted !== null &&
      askHolds(acted, project, runs, working)
        ? asked.kind
        : null,
    acted,
    ranUntil: ended.length === 0 ? null : Math.max(...ended),
    working,
  };
}

/**
 * Whether the person's ask still decides what shows. The other records do not show an ask as work
 * under way, so it holds until something that does: a publishing run starts after it, or a turn of
 * the coordinator that took it up ends. If nothing takes it up, it holds no longer than the hand-off
 * once nothing is at work, and no longer than UNTAKEN_MS while the coordinator is idle.
 */
function askHolds(
  at: number,
  project: ProjectRead,
  runs: readonly RunRead[],
  working: boolean,
) {
  const { coordinator } = project;
  const takenUp =
    (!coordinator.working &&
      coordinator.since !== undefined &&
      Date.parse(coordinator.since) > at) ||
    runs.some((run) => Date.parse(run.startedAt) > at);
  const settled = project.now >= at + HAND_OFF_MS;
  const unheard = !coordinator.working && project.now >= at + UNTAKEN_MS;
  return !takenUp && !(settled && (!working || unheard));
}

/**
 * Where publishing stands; undefined while there is no saved app to publish or nowhere to publish
 * it. The keep link and the holding are not states: each shows over whichever state applies while
 * it is recorded, because a person who misses the keep link's deadline loses their app, and a
 * holding costs money whatever else is true. When both a release and a holding are recorded, a
 * take-down is offered for the holding's target, because the holding is what the person pays for.
 * A keep link with nothing held means the app is not the person's yet and no take-down can reach
 * it, so none is offered then.
 */
export function publishState(project: ProjectRead): Publishing | undefined {
  const records = recordsOf(project);
  if (records === null) return undefined;
  const { release, holding } = records;
  const state = standing(records);
  const keep = keepNotice(records, project);
  const target = holding?.target ?? release?.target;
  return {
    state,
    keep,
    holding: holding ?? null,
    takeDown:
      (holding !== undefined || keep === null) &&
      OFFERS_TAKE_DOWN.has(state.state) &&
      records.takeDowns.some(({ plugin }) => plugin === target),
  };
}

// Whether a run is of an action a publish plan takes down with.
const removes = (records: Records, run: Pick<RunRead, "plugin" | "action">) =>
  records.takeDowns.some(
    ({ plugin, action }) => plugin === run.plugin && action === run.action,
  );

// Whether target still has a release or a holding recorded that a take-down of it would remove.
const stillRecorded = ({ release, holding }: Records, target: string) =>
  Object.keys(recordedFor(target, release, holding)).length > 0;

const endOf = (run: Pick<RunRead, "startedAt" | "endedAt">) =>
  Date.parse(run.endedAt ?? run.startedAt);

// What the latest publishing run means when it was a publish that failed or was blocked. If it
// recorded the release before it stopped, the app is published: the run may have stopped at an
// address slow to start answering, before its check ran. If it stopped after the latest release
// went out, the publish failed, and that is what the person last saw. If it is older than the
// release, it says nothing.
function outcomeOf(
  latest: RunRead,
  release: PublishRelease | undefined,
): "published" | "failed" | null {
  const started = Date.parse(latest.startedAt);
  const ended = endOf(latest);
  if (release === undefined) return "failed";
  const at = Date.parse(release.at);
  if (at >= started && at <= ended) return "published";
  return ended > at ? "failed" : null;
}

// The publishing run started last, which says how the latest publish or take-down went.
const latestOf = (runs: readonly RunRead[]): RunRead | undefined =>
  [...runs].sort(
    (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
  )[0];

const stopped = (run: RunRead) =>
  run.status === "failed" || run.blocked !== undefined;

// When work on the project last moved on: a run ended, or the person asked.
const movedAt = ({ acted, ranUntil }: Pick<Records, "acted" | "ranUntil">) =>
  Math.max(acted ?? -Infinity, ranUntil ?? -Infinity);

// Anything is at work on the project, or work moved on a moment ago and its next step is on its way
// to the coordinator.
const busy = (records: Records) =>
  records.working || records.project.now < movedAt(records) + HAND_OFF_MS;

// The person's go-ahead to take down still applies to the target it names: the removal is not done.
function askedToTakeDown({ takeDownAsked, release, holding }: Records) {
  return (
    takeDownAsked !== undefined &&
    takeDownStands(takeDownAsked, takeDownAsked.target, release, holding)
  );
}

// A completed take-down leaves the publish plan unfinished and its ending fact gone with the
// release, while the coordinator is still telling the person. None of that is a publish.
const tookDown = (records: Records, latest: RunRead | undefined) =>
  latest !== undefined &&
  removes(records, latest) &&
  latest.status === "completed" &&
  latest.blocked === undefined &&
  (records.release === undefined ||
    Date.parse(records.release.at) <= endOf(latest));

// Whether the saved app is newer than the release, with no publishing run started since it went out.
function isBehind(records: Records, release: PublishRelease) {
  const out = Date.parse(release.at);
  return (
    records.project.app.version !== release.version &&
    !records.runs.some(
      (run) => !removes(records, run) && Date.parse(run.startedAt) > out,
    )
  );
}

function standing(records: Records): PublishState {
  const { project, release } = records;
  if (project.asking.some(({ plugin }) => records.targets.has(plugin)))
    return { state: "needsYou" };
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
    stillRecorded(records, latest.plugin)
  )
    return {
      state: "takeDownFailed",
      reason: latest.blocked,
      released: release?.target === latest.plugin,
    };
  if (busy(records) && askedToTakeDown(records)) return { state: "takingDown" };
  const done = tookDown(records, latest);
  const behind = release !== undefined && isBehind(records, release);
  const live =
    release !== undefined &&
    records.ends.some((fact) => project.facts.has(fact));
  const openPublishPlans = project.planned.filter(
    ({ plan, finished }) => records.plans.includes(plan) && !finished,
  );
  if (busy(records) && !done && !behind && !live && openPublishPlans.length > 0)
    return { state: "publishing" };
  const outcome =
    latest !== undefined && stopped(latest) && !latestRemoves
      ? outcomeOf(latest, release)
      : null;
  // A failed step keeps its plan open with nothing ahead: what it needs, such as a change to the
  // app, is often worked on next.
  const planAhead =
    !done && openPublishPlans.some(({ state }) => state !== "failed");
  if (live) return { state: "published", url: release.url, at: release.at };
  if (release !== undefined && outcome === "published")
    return { state: "published", url: release.url, at: release.at };
  if (outcome === "failed") return { state: "failed", reason: latest?.blocked };
  if (release !== undefined && (behind || !planAhead))
    return { state: "changes", url: release.url, at: release.at };
  if (planAhead) return { state: "stalled" };
  return { state: "unpublished" };
}

/**
 * The next time, in the hub's milliseconds since the epoch, at which the clock alone changes what
 * publishState shows: the keep link's minutes left tick down or its deadline passes, or the project
 * stops counting as busy. undefined when nothing depends on the clock.
 */
export function changesAt(project: ProjectRead): number | undefined {
  const records = recordsOf(project);
  if (records === null) return undefined;
  const times: number[] = [];
  const settles = movedAt(records) + HAND_OFF_MS;
  if (settles > project.now) times.push(settles);
  const unheard = (records.acted ?? -Infinity) + UNTAKEN_MS;
  if (records.pressed !== null && unheard > project.now) times.push(unheard);
  const { keep } = records;
  if (keep !== undefined) {
    const left = Date.parse(keep.until) - project.now;
    if (left > 0) times.push(project.now + (left % 60_000) + 1);
  }
  return times.length === 0 ? undefined : Math.min(...times);
}

function keepNotice(
  { keep }: Records,
  project: ProjectRead,
): PublishKeepNotice | null {
  if (keep === undefined) return null;
  const { link, place } = keep;
  const left = Date.parse(keep.until) - project.now;
  if (left <= 0) return { link, place, passed: true };
  return { link, place, passed: false, minutesLeft: Math.floor(left / 60_000) };
}

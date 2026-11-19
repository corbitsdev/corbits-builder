/**
 * What the Publish tab and its control do. They read where publishing stands from the hub's
 * records: the latest check records, the coordinator's runs of the plugins that publish, the
 * release they recorded, what they hold that costs money, and the link to keep the app. They ask
 * the coordinator to publish or to take the app down. They clear the keep link once the person
 * kept the app, and clear the holding, or a release no take-down can reach, once the person says it
 * is gone. Every time here is by the hub's clock, worked out from the hub's answers.
 */
import { useEffect, useState } from "react";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  PUBLISH_GROUP,
  PUBLISH_HOLDING,
  PUBLISH_KEEP,
  PUBLISH_RELEASE,
  PUBLISH_TAKE_DOWN,
  PublishHolding,
  PublishRelease,
  PublishTakeDown,
} from "@corbits-builder/plugin/publish";
import type { QuestionAnswer } from "@corbits-builder/schemas/conversation";
import { type } from "arktype";
import {
  readProjectChecks,
  readProjectRuns,
  readProjectValues,
  saveProjectValues,
} from "../../api/artifacts.ts";
import { latestHubDate, type HubDate } from "../../api/transport.ts";
import { wording } from "../../config.ts";
import { keys } from "../../queries/keys.ts";
import {
  atWork,
  changesAt,
  HAND_OFF_MS,
  publishState,
  type PublishRecords,
  type PublishState,
  type Publishing,
} from "./publish-state.ts";
import type { PublishViewProps } from "./publish.view.tsx";
import type { ScreenQuestionProps } from "./screen-question.tsx";
import { planEndsIn, readyPlansIn, specialistsIn } from "./screens.ts";

// Polls while a publishing run is at work, because nothing else tells the room when it ends.
const PUBLISHING_POLL_MS = 5_000;

type Read = Pick<
  PublishRecords,
  "checks" | "runs" | "release" | "holding" | "takeDown" | "ranUntil"
> & {
  /** How far the hub's clock is ahead of this page's, in milliseconds, going by its answers. */
  offset: number;
};

/**
 * How far the hub's clock is ahead of this page's, from the Date header of one of its answers and
 * when this page received it; 0 before any answer had one. The header counts whole seconds, so the
 * hub's time is taken as the middle of its second. The hand-off compares the hub's times with the
 * page's, and a clock half a minute out would end it at once or stretch it.
 */
export function hubOffset(seen: HubDate | null): number {
  if (seen === null) return 0;
  const sent = Date.parse(seen.date);
  return Number.isNaN(sent) ? 0 : sent + 500 - seen.receivedAt;
}

/**
 * This page's readings of the time by the hub's clock, which publishState and pressHolds compare
 * with the hub's records. offset is how far the hub's clock is ahead of this page's.
 */
export function hubTimes(
  offset: number,
  page: { now: number; turnEndedAt: number | null },
): { now: number; turnEndedAt: number | null } {
  return {
    now: page.now + offset,
    turnEndedAt: page.turnEndedAt === null ? null : page.turnEndedAt + offset,
  };
}

// The records only the hub has: the checks, the runs of the plugins that publish, when any run last
// ended, the release, the holding, the go-ahead to take down, and the hub's clock offset.
async function readPublishRecords(
  projectId: string,
  signal: AbortSignal,
): Promise<Read> {
  const publishers = specialistsIn(PUBLISH_GROUP);
  const [checks, runs, values] = await Promise.all([
    readProjectChecks(projectId, signal),
    readProjectRuns(projectId, signal),
    readProjectValues(
      projectId,
      [PUBLISH_RELEASE, PUBLISH_HOLDING, PUBLISH_TAKE_DOWN],
      signal,
    ),
  ]);
  const ends = runs.flatMap((run) =>
    run.endedAt === undefined ? [] : [Date.parse(run.endedAt)],
  );
  return {
    checks,
    runs: runs.filter((run) => publishers.includes(run.plugin)),
    ranUntil: ends.length === 0 ? null : Math.max(...ends),
    release: values[PUBLISH_RELEASE],
    holding: values[PUBLISH_HOLDING],
    takeDown: values[PUBLISH_TAKE_DOWN],
    offset: hubOffset(latestHubDate()),
  };
}

/** What the person pressed, which the tab keeps showing until the coordinator takes it up. */
type Pressed = "publish" | "takeDown";

/**
 * What a press becomes once the person answers a publishing question it led to. An answer the
 * screen took keeps the press, unless it was the take-down screen's answer and recorded no
 * go-ahead, as Keep it does. A reply in the person's own words goes to the coordinator, which is
 * the only one that can read it, so it keeps nothing. Neither does an answer given with nothing
 * pressed.
 */
export function pressAfterAnswer(
  held: Pressed | null,
  answer: QuestionAnswer,
  takeDown: unknown,
): Pressed | null {
  if (held === null || !("output" in answer)) return null;
  if (held === "takeDown" && PublishTakeDown(takeDown) instanceof type.errors)
    return null;
  return held;
}

/** A press the tab keeps, timed by the hub's clock, and whether a publish plan was on the plan. */
type Press = { at: number; planned: boolean; kind: Pressed };

/**
 * Whether a press still decides what the tab shows, all times by the hub's clock. The records do
 * not show a press or an answer as a publish under way, so the press holds until something that
 * does: the coordinator ends a turn after it, a publishing run starts after it, or, for a first
 * publish, a publish plan goes on the plan. A plan already there from an earlier publish says
 * nothing about this one. If nothing takes the press up, for example because the message never
 * reached the coordinator, it holds no longer than the hand-off once nothing is at work.
 */
export function pressHolds(
  press: Press,
  seen: {
    planned: boolean;
    turnEndedAt: number | null;
    runs: readonly { startedAt: string }[];
    working: boolean;
    now: number;
  },
): boolean {
  const takenUp =
    (seen.planned && !press.planned) ||
    (seen.turnEndedAt !== null && seen.turnEndedAt > press.at) ||
    seen.runs.some((run) => Date.parse(run.startedAt) > press.at);
  const lapsed = !seen.working && seen.now >= press.at + HAND_OFF_MS;
  return !takenUp && !lapsed;
}

type PublishTabInput = {
  projectId: string;
  savedApp: boolean;
  /** The open question publishing waits on, drawn in the tab; null when there is none. */
  question: ScreenQuestionProps | null;
  plan: PublishRecords["plan"];
  working: PublishRecords["working"];
  /** When this page last saw a coordinator turn end, in milliseconds since the epoch; null before. */
  turnEndedAt: number | null;
  archived: boolean;
  sending: boolean;
  /** Sends the person's own message to the coordinator and returns whether it was sent. */
  deliver: (message: string) => Promise<boolean>;
  onOpen: () => void;
};

/**
 * The Publish tab's props, and where publishing stands for its control; usePublishTab gives null
 * while there is nothing to publish.
 */
export type PublishTab = {
  publishing: Publishing;
  view: Omit<PublishViewProps, "question"> & {
    question: ScreenQuestionProps | null;
  };
};

export function usePublishTab({
  projectId,
  savedApp,
  question,
  plan,
  working,
  turnEndedAt,
  archived,
  sending,
  deliver,
  onOpen,
}: PublishTabInput): PublishTab | null {
  const queryClient = useQueryClient();
  const ends = planEndsIn(PUBLISH_GROUP);
  const offered = readyPlansIn(PUBLISH_GROUP);
  const plans = offered.map(({ handle }) => handle);
  const takeDowns = offered.flatMap(({ takeDown }) =>
    takeDown === undefined
      ? []
      : [{ plugin: takeDown.plugin, action: takeDown.action }],
  );
  const reads = savedApp && ends.length > 0;
  const read = useQuery<Read>({
    queryKey: keys.publish.of(projectId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data?.runs.some(atWork) === true ? PUBLISHING_POLL_MS : false,
    queryFn: reads
      ? ({ signal }) => readPublishRecords(projectId, signal)
      : skipToken,
  });
  // Read in its own query and never persisted, because the link works like a password.
  const keepRead = useQuery({
    queryKey: keys.publish.keep(projectId),
    retry: false,
    refetchOnWindowFocus: false,
    meta: { persist: false },
    queryFn: reads
      ? async ({ signal }) =>
          (await readProjectValues(projectId, [PUBLISH_KEEP], signal))[
            PUBLISH_KEEP
          ] ?? null
      : skipToken,
  });
  const keep = keepRead.data;
  const [now, setNow] = useState(() => Date.now());
  // Either answer clears the keep link. An app the person did not keep was removed at the target,
  // so its release no longer says where the app is and is cleared too.
  const kept = useMutation({
    mutationFn: (gone: boolean) =>
      saveProjectValues(projectId, {
        [PUBLISH_KEEP]: null,
        ...(gone ? { [PUBLISH_RELEASE]: null } : {}),
      }),
    onSuccess: async (_saved, gone) => {
      queryClient.setQueryData(keys.publish.keep(projectId), null);
      if (gone)
        await queryClient.invalidateQueries({
          queryKey: keys.publish.of(projectId),
        });
    },
  });

  // The person says the holding, or a release no take-down could reach, is gone because they
  // removed it themselves. An app published on the target that had the holding went with it, so
  // that target's release no longer says where the app is. Once the release is cleared, so is the
  // go-ahead to take it down.
  const gone = useMutation({
    mutationFn: (what: "holding" | "release") => {
      if (what === "release")
        return saveProjectValues(projectId, {
          [PUBLISH_RELEASE]: null,
          [PUBLISH_TAKE_DOWN]: null,
        });
      const holding = PublishHolding(read.data?.holding);
      const release = PublishRelease(read.data?.release);
      const sameTarget =
        !(holding instanceof type.errors) &&
        !(release instanceof type.errors) &&
        holding.target === release.target;
      return saveProjectValues(projectId, {
        [PUBLISH_HOLDING]: null,
        ...(sameTarget ? { [PUBLISH_RELEASE]: null } : {}),
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: keys.publish.of(projectId) }),
  });

  // This page's clock corrected by the hub's latest answer. Every time here uses it.
  const offset = read.data?.offset ?? 0;
  const byHub = hubTimes(offset, { now, turnEndedAt });
  const hubNow = () =>
    hubTimes(offset, { now: Date.now(), turnEndedAt: null }).now;
  // What the person pressed, or answered after pressing, kept as pressHolds says. It lives only in
  // this page, so a reload in that short window shows the records until they catch up.
  const [pressed, setPressed] = useState<Press | null>(null);
  const planned = plan.some(
    (entry) => entry.plan !== undefined && plans.includes(entry.plan),
  );
  const holds =
    pressed !== null &&
    pressHolds(pressed, {
      planned,
      turnEndedAt: byHub.turnEndedAt,
      runs: read.data?.runs ?? [],
      working,
      now: byHub.now,
    });
  useEffect(() => {
    if (pressed !== null && !holds) setPressed(null);
  }, [pressed, holds]);
  // When the person last pressed or gave an answer that moved the work on. It outlasts the press,
  // and like the press it lives only in this page.
  const [acted, setActed] = useState<number | null>(null);
  const hold = (kind: Pressed | null) => {
    const at = hubNow();
    setPressed(kind === null ? null : { at, planned, kind });
    if (kind !== null) setActed(at);
  };

  // A publishing question opens the Publish tab once, when the question opens.
  const asked = question?.signalName;
  useEffect(() => {
    if (asked !== undefined) onOpen();
  }, [asked]);

  const held = pressed !== null && holds ? pressed.kind : null;
  const records: PublishRecords | null =
    read.data === undefined
      ? null
      : {
          ...read.data,
          savedApp,
          ends,
          asking: question !== null,
          plans,
          takeDowns,
          plan,
          working,
          pressed: held,
          acted,
          keep,
          now: byHub.now,
        };
  // The time is read again only when it changes what the tab shows, so the keep link's countdown
  // and the end of a hand-off update on their own while the page is open. A wake that is already
  // due, for example because the records arrived after it, reads the time at once.
  const wake = records === null ? null : changesAt(records);
  useEffect(() => {
    if (wake === null) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(
        0,
        wake - hubTimes(offset, { now: Date.now(), turnEndedAt: null }).now,
      ),
    );
    return () => clearTimeout(timer);
  }, [wake, offset]);

  if (records === null) return null;
  const publishing = publishState(records);
  if (publishing === null) return null;

  const press = async (kind: Pressed) => {
    hold(kind);
    // Sent in the person's own words, so the conversation records it as theirs.
    const message =
      kind === "takeDown"
        ? wording.publish.message.takeDown
        : publishMessage(publishing.state);
    if (!(await deliver(message))) setPressed(null);
  };
  return {
    publishing,
    view: {
      publish: publishing,
      onPublish: archived ? undefined : () => void press("publish"),
      onTakeDown: archived ? undefined : () => void press("takeDown"),
      sending,
      // An answer to a question the press led to keeps the press until the coordinator takes it up,
      // and an answer that moves the work on keeps the project busy for a moment after it. The
      // records are read again first, so an answer that turned the press down does neither.
      question:
        question === null
          ? null
          : {
              ...question,
              onAnswer: async (given) => {
                const kind = held;
                const sent = await question.onAnswer(given);
                if (!sent) return sent;
                await queryClient.invalidateQueries({
                  queryKey: keys.publish.of(projectId),
                });
                const after = queryClient.getQueryData<Read>(
                  keys.publish.of(projectId),
                );
                const goesOn = pressAfterAnswer(kind, given, after?.takeDown);
                hold(goesOn);
                // An answer the screen took moves the work on, unless it turned down what was
                // pressed, as Keep it does. With nothing pressed, the records decide, and Keep it
                // leaves no take-down asked for there.
                if ("output" in given && (kind === null || goesOn !== null))
                  setActed(hubNow());
                return sent;
              },
            },
      onKept: archived ? undefined : () => kept.mutate(false),
      onGone: archived ? undefined : () => kept.mutate(true),
      keeping: kept.isPending,
      keptFault: kept.isError ? wording.publish.keep.notSaved : null,
      onHeldGone: archived ? undefined : () => gone.mutate("holding"),
      onReleaseGone: archived ? undefined : () => gone.mutate("release"),
      clearing: gone.isPending,
      clearFault: gone.isError ? wording.publish.goneNotSaved : null,
    },
  };
}

// What pressing the Publish tab's button asks the coordinator, in the person's own words.
function publishMessage(state: PublishState) {
  if (state.state === "changes") return wording.publish.message.changes;
  if (state.state === "stalled") return wording.publish.message.continue;
  return wording.publish.message.publish;
}

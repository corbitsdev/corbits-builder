/**
 * The one line above the prompt box saying what is happening, and its one button. Rules are checked
 * in order and the first that fits wins: work going on comes first, then what failed and wants
 * another try, then what is new to look at, then the running app. None is checked while the box
 * asks the person something. Plain data in, plain data out, so each rule is tested without a hub.
 */
import type { PlanView } from "@corbits-builder/schemas/plan";
import type { ConversationTurn } from "../../../api/conversation.ts";
import type { Wait } from "../../../api/types.ts";
import { wording } from "../../../config.ts";
import {
  awaitingReply,
  liveTurnStreaming,
  parkedOnApproval,
  waitingOnPerson,
  type LiveRun,
} from "../chat/live-run.ts";
import type { TranscriptTurn } from "../chat/visible-chat.ts";

const text = wording.promptBox.status;

/** What the room knows that the line may speak of. */
export type RoomStatusFacts = {
  /** A message is on its way to the coordinator. */
  sending: boolean;
  /** The coordinator is mid-turn. */
  thinking: boolean;
  /** Specialists at work, each by what it does, in the order they started. */
  working: readonly { runId: string; doing: string }[];
  /** Specialist runs that failed, each by what it was doing and when it ended, in ms. */
  failed: readonly { doing: string; endedAt: number }[];
  /** When the person last sent the coordinator a message, in ms; null when never. */
  lastSentAt: number | null;
  /** The project's plan, as the hub reads it. */
  plan: PlanView["steps"];
  /** The project's documents, newest filed last, and whether this viewer opened each version. */
  documents: readonly {
    id: string;
    title: string;
    version: number;
    seen: boolean;
  }[];
  /** How the project's app stands while the project is open; null while there is none to run. */
  app: "running" | "starting" | "failed" | "stopped" | "not_built" | null;
  /** The box waits on the person: a question, a screen or an approval. */
  asking: boolean;
  /** The project fills the window, so its documents and app are already in reach. */
  projectOpen: boolean;
};

/** What the line's one button does; the model gives each its handler. */
export type RoomStatusAction =
  | { kind: "openDocument"; id: string }
  | { kind: "openApp" }
  | { kind: "tryAgain"; message: string };

export type RoomStatus = {
  state: "working" | "running" | "failed" | "ready";
  label: string;
  action: ({ label: string } & RoomStatusAction) | null;
};

type Rule = (facts: RoomStatusFacts) => RoomStatus | undefined;

const working = (label: string): RoomStatus => ({
  state: "working",
  label,
  action: null,
});

// Stopped work is the person's next step, not an error in front of them, so it reads as one.
const tryAgain = (label: string): RoomStatus => ({
  state: "ready",
  label,
  action: {
    label: text.tryAgain,
    kind: "tryAgain",
    message: text.tryAgainMessage,
  },
});

type PlanChild = Exclude<PlanView["steps"][number], { steps: unknown }>;

const children = (plan: PlanView["steps"]): PlanChild[] =>
  plan.flatMap((step) => ("steps" in step ? step.steps : [step]));

/** The rules, in the order they are checked. */
export const rules: readonly { name: string; rule: Rule }[] = [
  {
    name: "a message is on its way",
    rule: ({ sending }) => (sending ? working(text.sending) : undefined),
  },
  {
    // What a specialist does is what the person waits on, so it is said before the coordinator's
    // own thinking, which goes on around it.
    name: "specialists are at work",
    rule: ({ working: runs }) => {
      const [first, ...rest] = runs;
      if (first === undefined) return undefined;
      return working(
        rest.length === 0
          ? first.doing
          : text.andMore(first.doing, rest.length),
      );
    },
  },
  {
    name: "the coordinator is working",
    rule: ({ thinking }) => (thinking ? working(text.thinking) : undefined),
  },
  {
    // A failure the person wrote after has been seen and answered; only a newer one asks again.
    name: "work failed since the person last wrote",
    rule: ({ failed, lastSentAt }) => {
      const latest = failed.reduce<(typeof failed)[number] | undefined>(
        (newest, run) =>
          newest === undefined || run.endedAt > newest.endedAt ? run : newest,
        undefined,
      );
      if (latest === undefined) return undefined;
      if (lastSentAt !== null && latest.endedAt <= lastSentAt) return undefined;
      return tryAgain(text.stopped(latest.doing));
    },
  },
  {
    name: "a step of the plan failed",
    rule: ({ plan }) => {
      const failed = children(plan).find((step) => step.state === "failed");
      return failed === undefined
        ? undefined
        : tryAgain(text.stopped(failed.title));
    },
  },
  {
    name: "a version the person has not opened",
    rule: ({ documents }) => {
      const unseen = documents.findLast((document) => !document.seen);
      if (unseen === undefined) return undefined;
      return {
        state: "ready",
        label: text.ready(unseen.title, unseen.version),
        action: { label: text.open, kind: "openDocument", id: unseen.id },
      };
    },
  },
  {
    name: "the app is running",
    rule: ({ app }) =>
      app === "running"
        ? {
            state: "running",
            label: text.appRunning,
            action: { label: text.open, kind: "openApp" },
          }
        : undefined,
  },
  {
    name: "the app did not start",
    rule: ({ app }) =>
      app === "failed"
        ? {
            state: "failed",
            label: text.appFailed,
            action: { label: text.open, kind: "openApp" },
          }
        : undefined,
  },
];

/** The line and its button from the first rule that fits; null while none does. */
export function roomStatus(facts: RoomStatusFacts): RoomStatus | null {
  // The box's question is the person's next step; a line above it would pull the eye away.
  if (facts.asking) return null;
  for (const { rule } of rules) {
    const status = rule(facts);
    if (status === undefined) continue;
    // Over the open project, a line pointing into it points at what is already on screen.
    if (facts.projectOpen && opensProject(status)) continue;
    return status;
  }
  return null;
}

const opensProject = ({ action }: RoomStatus) =>
  action?.kind === "openDocument" || action?.kind === "openApp";

/** When the person last wrote: their latest turn, or a send this session has not seen land yet. */
export function lastSentAt(
  awaitingSince: number | null,
  turns: readonly TranscriptTurn[],
): number | null {
  const wrote = turns.findLast((turn) => turn.role === "person")?.at;
  if (wrote === undefined) return awaitingSince;
  return awaitingSince === null ? wrote : Math.max(wrote, awaitingSince);
}

/** What the room has read about the coordinator and the person's turn with it. */
export type RoomPhaseFacts = {
  /** The project's lifecycle, as the hub or the project list says it. */
  status: string;
  /** A coordinator is bound: the room's events were read. */
  bound: boolean;
  /** The committed conversation. */
  mirror: readonly ConversationTurn[];
  /** The conversation's last turn, with this session's sends that have not landed yet. */
  lastTurnRole: TranscriptTurn["role"] | undefined;
  liveRun: LiveRun;
  /** The coordinator's run; null while none is bound or the project is archived. */
  runId: string | null;
  /** The open decisions; undefined until read. */
  waits: readonly Wait[] | undefined;
  /** The approvals still pending, by id. */
  openApprovals: ReadonlySet<string>;
  /** The coordinator's question waits on the person. */
  questionOpen: boolean;
  /** The coordinator as the hub reads who is at work; undefined while it is not. */
  coordinator: { readonly since: string } | undefined;
  /** A message is on its way. */
  sending: boolean;
  /** A decision is on its way. */
  approvalBusy: boolean;
  /** The last send, or the coordinator's run, failed. */
  failed: boolean;
  /** When this session's latest message left, in ms; null when none waits on a reply. */
  awaitingSince: number | null;
  /** Why the coordinator did not start; null when it did or has not tried. */
  startFault: string | null;
  /** The coordinator has no model to run on. */
  modelNeeded: boolean;
  /** No model provider is connected. */
  providerMissing: boolean;
};

/**
 * Where the room stands with its coordinator. These are not one state but answers that overlap:
 * the coordinator can be thinking while its reply streams, and an unbound room between
 * coordinators both thinks and keeps the composer waiting.
 */
export type RoomPhase = {
  /** The coordinator waits on the person: its question, or an approval its own run raised. */
  parked: boolean;
  /** The live reply is still being written. */
  streaming: boolean;
  /** The hub reads the coordinator mid-turn. */
  working: boolean;
  /** The coordinator is held on the person, so being mid-turn is not working. */
  held: boolean;
  /** A message sent here still waits on its reply. */
  awaiting: boolean;
  /** The thinking mark shows. */
  thinking: boolean;
  /** No coordinator is bound. */
  unbound: boolean;
  /** An unbound project that has talked before, waiting on its next coordinator. */
  between: boolean;
  /** An active project waits for its coordinator to bind. */
  awaitingBind: boolean;
  /** A message or a decision is on its way. */
  busy: boolean;
  /** Nothing can be written yet. */
  composerWaits: boolean;
  /** The composer takes nothing. */
  composerDisabled: boolean;
};

export function roomPhase(facts: RoomPhaseFacts): RoomPhase {
  const { waits, openApprovals, runId, liveRun, mirror } = facts;
  const unbound = !facts.bound;
  // A refused start, or no model to run on, is the person's to settle, so nothing reads as on its way.
  const startClear = facts.startFault === null && !facts.modelNeeded;
  // Until the open decisions are read, no approval is known to hold the coordinator. An open
  // question holds it too, though its message run stays open while it waits.
  const parked =
    facts.questionOpen ||
    (waits !== undefined && parkedOnApproval(waits, openApprovals, runId));
  // Mid-turn by the hub's read: the coordinator's run began after the last end this stream saw.
  // The stream's own flag is not used; a frame missed while the tab is hidden leaves it set.
  const working =
    facts.coordinator !== undefined &&
    (liveRun.endedAt === null ||
      Date.parse(facts.coordinator.since) > liveRun.endedAt);
  const held =
    facts.questionOpen ||
    (waits !== undefined &&
      waitingOnPerson(waits, openApprovals, runId, liveRun.running));
  const awaiting =
    awaitingReply(
      facts.awaitingSince,
      facts.lastTurnRole,
      liveRun.endedAt,
      parked,
    ) &&
    facts.status !== "archived" &&
    startClear;
  // A project that has talked before is between coordinators (an upgrade, a reopen): its thread
  // stays and reads as the coordinator at work, not as a project starting from nothing.
  const between = unbound && mirror.length > 0 && startClear;
  const busy = facts.sending || facts.approvalBusy;
  const composerWaits = busy || unbound;
  return {
    parked,
    streaming: liveTurnStreaming(liveRun, mirror, parked),
    working,
    held,
    awaiting,
    // The mark stays for the whole turn: between model calls and during long tool work the live
    // reply shows nothing moving.
    thinking:
      !facts.failed &&
      (facts.sending || awaiting || (working && !held) || between),
    unbound,
    between,
    awaitingBind: facts.status === "active" && unbound && startClear,
    busy,
    composerWaits,
    composerDisabled: composerWaits || facts.providerMissing,
  };
}

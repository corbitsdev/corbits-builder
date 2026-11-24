/**
 * The one line above the prompt box saying what is happening, and its one button. Rules are checked
 * in order and the first that fits wins: work going on comes first, then what failed and wants
 * another try, then what is new to look at, then the running app. Plain data in, plain data out, so
 * each rule is tested without a hub.
 */
import type { PlanView } from "@corbits-builder/schemas/project";
import { wording } from "../../config.ts";

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
  /** The box asks the person to accept something, and its screen opens what it asks about. */
  deciding: boolean;
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

const tryAgain = (label: string): RoomStatus => ({
  state: "failed",
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
      return tryAgain(text.didNotFinish(latest.doing));
    },
  },
  {
    name: "a step of the plan failed",
    rule: ({ plan }) => {
      const failed = children(plan).find((step) => step.state === "failed");
      return failed === undefined
        ? undefined
        : tryAgain(text.stepFailed(failed.title));
    },
  },
  {
    // A screen asking the person to accept a document already opens it, so the line does not.
    name: "a version the person has not opened",
    rule: ({ documents, deciding }) => {
      if (deciding) return undefined;
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

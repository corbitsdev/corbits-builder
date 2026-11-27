/**
 * What waits on the person, and in what order: the coordinator's question, then approvals, then
 * steps waiting for their go-ahead, then plugin screens, then the warning about the words they are
 * about to send. The prompt box shows the first of these as its one card; every plugin screen also
 * opens, in this order, in the plugin space. Plain data in, plain data out, so each rule is tested
 * without a hub.
 */
import type { PlanView } from "@corbits-builder/schemas/plan";

/** A plugin's screen, by the plugin and action that draw it, with what the person calls it. */
export type WaitingScreenSource = {
  plugin: string;
  action: string;
  title: string;
};

/** What the room knows that might wait on the person. */
export type WaitingRoom = {
  /**
   * The coordinator's open question; one drawn by a plugin's screen names it. The coordinator asks
   * one at a time, so there is at most one.
   */
  question: {
    signalName: string;
    screen: WaitingScreenSource | null;
  } | null;
  /** The approvals no one has decided yet, each with when it was raised where that is known. */
  approvals: readonly { approvalId: string; at?: number | undefined }[];
  /** The project's plan, as the hub reads it. */
  plan: PlanView["steps"];
  /** The screens plugins show of their own accord, in the order the hub lists them. */
  screens: readonly WaitingScreenSource[];
  /** What sending the words in the box would restart; null while they restart nothing. */
  restarts: string | null;
};

export type Waiting =
  | { kind: "question"; key: string; signalName: string }
  | { kind: "approval"; key: string; approvalId: string }
  | { kind: "step"; key: string; stepId: string; title: string }
  | ({ kind: "screen"; key: string } & (
      | { from: "question"; signalName: string }
      | { from: "plugin" }
    ) &
      WaitingScreenSource)
  | { kind: "warning"; key: string; text: string };

export type WaitingScreen = Extract<Waiting, { kind: "screen" }>;

type PlanChild = Exclude<PlanView["steps"][number], { steps: unknown }>;

const children = (plan: PlanView["steps"]): PlanChild[] =>
  plan.flatMap((step) => ("steps" in step ? step.steps : [step]));

/** A step the person asked to be consulted on, which holds until they say go ahead. */
export const waitsForGoAhead = (step: PlanChild) =>
  step.askFirst && step.goAhead === undefined && step.state === "needs_you";

/** Everything that waits on the person, in the order they meet it. */
export function waitingOn(room: WaitingRoom): Waiting[] {
  const { question } = room;
  const asking: Waiting[] =
    question === null || question.screen !== null
      ? []
      : [
          {
            kind: "question",
            key: `question:${question.signalName}`,
            signalName: question.signalName,
          },
        ];
  // Raised earliest first; one with no known time after those, in the order read.
  const approvals = room.approvals
    .map((approval, order) => ({ ...approval, order }))
    .sort(
      (left, right) =>
        (left.at ?? Number.POSITIVE_INFINITY) -
          (right.at ?? Number.POSITIVE_INFINITY) || left.order - right.order,
    )
    .map(({ approvalId }): Waiting => ({
      kind: "approval",
      key: `approval:${approvalId}`,
      approvalId,
    }));
  const steps = children(room.plan)
    .filter(waitsForGoAhead)
    .map((step): Waiting => ({
      kind: "step",
      key: `step:${step.id}`,
      stepId: step.id,
      title: step.title,
    }));
  // The screen that answers the coordinator holds its turn, so it comes before a plugin's own.
  const screens: Waiting[] = [
    ...(question === null || question.screen === null
      ? []
      : [
          {
            kind: "screen" as const,
            key: `screen:${question.signalName}`,
            from: "question" as const,
            signalName: question.signalName,
            ...question.screen,
          },
        ]),
    ...room.screens.map((screen): Waiting => ({
      kind: "screen",
      key: `screen:${screen.plugin} ${screen.action}`,
      from: "plugin",
      ...screen,
    })),
  ];
  const warning: Waiting[] =
    room.restarts === null
      ? []
      : [{ kind: "warning", key: "warning", text: room.restarts }];
  return [...asking, ...approvals, ...steps, ...screens, ...warning];
}

export type WaitingCard = Exclude<Waiting, { kind: "warning" }>;

/** The one card the prompt box holds: the first thing waiting that is not the send warning. */
export function boxCard(waiting: readonly Waiting[]): WaitingCard | null {
  return (
    waiting.find((item): item is WaitingCard => item.kind !== "warning") ?? null
  );
}

/** The plugin space's screens, the one it shows first. */
export function spaceScreens(waiting: readonly Waiting[]): WaitingScreen[] {
  return waiting.filter(
    (item): item is WaitingScreen => item.kind === "screen",
  );
}

/** The warning above the words, if sending them would restart work. */
export function sendWarning(waiting: readonly Waiting[]): string | null {
  const found = waiting.find((item) => item.kind === "warning");
  return found === undefined ? null : found.text;
}

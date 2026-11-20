/**
 * Sample projects, as plain data, for the tests of the room's logic files: a project in each state
 * worth telling apart, from one where nothing waits on the person to one where everything does.
 */
import type { PlanView } from "@corbits-builder/schemas/project";
import type { WaitingRoom } from "./waiting.ts";

type PlanChild = Exclude<PlanView["steps"][number], { steps: unknown }>;

function step(
  id: string,
  title: string,
  state: PlanChild["state"],
  more: Partial<PlanChild> = {},
): PlanChild {
  return {
    id,
    title,
    plugin: "writer",
    action: "write",
    input: {},
    askFirst: false,
    state,
    kind: "workflow",
    ...more,
  };
}

const at = (iso: string) => Date.parse(iso);

/** The bakery's plan: the brief done, the plan held for the person's go-ahead, the build to come. */
const bakeryPlan: PlanView["steps"] = [
  step("brief", "Write the problem brief", "done"),
  {
    id: "build",
    title: "Build",
    state: "needs_you",
    steps: [
      step("plan", "Write the build plan", "needs_you", { askFirst: true }),
      step("code", "Build the app", "not_started", { askFirst: true }),
    ],
  },
];

const fontScreen = {
  plugin: "designer",
  action: "pick-fonts",
  title: "Pick the fonts",
};

const notesScreen = {
  plugin: "tester",
  action: "notes",
  title: "Notes for the tester",
};

/** What waits on the person in each sample project. */
export const waitingRooms = {
  /** A project just started: nothing asked, nothing to approve. */
  quiet: {
    question: null,
    approvals: [],
    plan: [],
    screens: [],
    restarts: null,
  },
  /** The coordinator asks what people will order. */
  asking: {
    question: { signalName: "orders", screen: null },
    approvals: [],
    plan: [],
    screens: [],
    restarts: null,
  },
  /** Two asks to approve, the later raised first in the read, and one with no time at all. */
  approving: {
    question: null,
    approvals: [
      { approvalId: "install-zod", at: at("2026-11-20T10:05:00Z") },
      { approvalId: "unknown-time" },
      { approvalId: "run-build", at: at("2026-11-20T10:01:00Z") },
    ],
    plan: [],
    screens: [],
    restarts: null,
  },
  /** The person asked to be consulted before the build plan; the build waits behind it. */
  consulting: {
    question: null,
    approvals: [],
    plan: bakeryPlan,
    screens: [],
    restarts: null,
  },
  /** A step that asked first, given the go-ahead already, or not yet reached, waits on no one. */
  goneAhead: {
    question: null,
    approvals: [],
    plan: [
      step("plan", "Write the build plan", "needs_you", {
        askFirst: true,
        goAhead: { by: "person", at: "2026-11-20T10:00:00Z" },
      }),
      step("code", "Build the app", "waiting", { askFirst: true }),
      step("brief", "Write the problem brief", "needs_you"),
    ],
    screens: [],
    restarts: null,
  },
  /** The coordinator asks with the designer's font screen, and the tester shows its notes. */
  screens: {
    question: { signalName: "fonts", screen: fontScreen },
    approvals: [],
    plan: [],
    screens: [notesScreen],
    restarts: null,
  },
  /** Only a plugin's own screen, with no question open. */
  pluginScreen: {
    question: null,
    approvals: [],
    plan: [],
    screens: [notesScreen],
    restarts: null,
  },
  /** The words typed would restart the design. */
  restarting: {
    question: null,
    approvals: [],
    plan: [],
    screens: [],
    restarts: "Sending this restarts the design.",
  },
  /** Everything at once, each kind in the order it is read. */
  everything: {
    question: { signalName: "orders", screen: null },
    approvals: [{ approvalId: "run-build", at: at("2026-11-20T10:01:00Z") }],
    plan: bakeryPlan,
    screens: [notesScreen],
    restarts: "Sending this restarts the design.",
  },
} satisfies Record<string, WaitingRoom>;

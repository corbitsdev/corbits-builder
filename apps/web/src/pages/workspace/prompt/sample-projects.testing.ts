/**
 * Sample projects, as plain data, for the tests of the room's logic files: a project in each state
 * worth telling apart, from one where nothing waits on the person to one where everything does.
 */
import { isFinished } from "@corbits-builder/plan";
import type { PlanView } from "@corbits-builder/schemas/plan";
import type { WaitingRoom } from "./waiting.ts";
import type { RoomStatusFacts } from "./room-status.ts";

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
    finished: isFinished(state),
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
    finished: false,
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

const quietFacts: RoomStatusFacts = {
  sending: false,
  thinking: false,
  working: [],
  failed: [],
  lastSentAt: null,
  plan: [],
  documents: [],
  app: null,
  asking: false,
  projectOpen: false,
};

/** What is happening in each sample project, as the status line reads it. */
export const statusRooms = {
  /** Nothing moving, nothing new. */
  quiet: quietFacts,
  /** A message on its way to the coordinator. */
  sending: { ...quietFacts, sending: true, thinking: true },
  /** The coordinator works on its reply, with no specialist at work. */
  thinking: { ...quietFacts, thinking: true },
  /** The writer drafts the brief while the coordinator thinks. */
  writing: {
    ...quietFacts,
    thinking: true,
    working: [{ runId: "run-writer", doing: "Writing the problem brief" }],
  },
  /** Two specialists at work at once. */
  writingAndDesigning: {
    ...quietFacts,
    working: [
      { runId: "run-writer", doing: "Writing the problem brief" },
      { runId: "run-designer", doing: "Designing the app" },
    ],
  },
  /** The build stopped after the person's last message, and nothing has run since. */
  buildFailed: {
    ...quietFacts,
    failed: [
      {
        doing: "Writing the problem brief",
        endedAt: at("2026-11-20T09:00:00Z"),
      },
      { doing: "Building the app", endedAt: at("2026-11-20T10:10:00Z") },
    ],
    lastSentAt: at("2026-11-20T10:00:00Z"),
    documents: [
      { id: "build_plan", title: "Build plan", version: 1, seen: false },
    ],
  },
  /** The build failed before the person wrote again, so they already know. */
  failedBeforeMessage: {
    ...quietFacts,
    failed: [
      { doing: "Building the app", endedAt: at("2026-11-20T09:00:00Z") },
    ],
    lastSentAt: at("2026-11-20T10:00:00Z"),
  },
  /** A step of the plan failed. */
  stepFailed: {
    ...quietFacts,
    plan: [
      step("brief", "Write the problem brief", "done"),
      {
        id: "build",
        title: "Build",
        state: "failed",
        finished: false,
        steps: [step("code", "Build the app", "failed")],
      },
    ],
  },
  /** A new version of the build plan the person has not opened, beside an older one they have. */
  newVersion: {
    ...quietFacts,
    documents: [
      { id: "problem_brief", title: "Problem brief", version: 2, seen: false },
      { id: "build_plan", title: "Build plan", version: 3, seen: false },
      { id: "design", title: "Design", version: 1, seen: true },
    ],
  },
  /** A new version, while the box asks the person to approve it and opens it from there. */
  approving: {
    ...quietFacts,
    documents: [
      { id: "build_plan", title: "Build plan", version: 3, seen: false },
    ],
    asking: true,
  },
  /** A first draft filed while the box still asks the person a question its writer needs. */
  answering: {
    ...quietFacts,
    documents: [
      { id: "requirements", title: "Requirements", version: 1, seen: false },
    ],
    asking: true,
  },
  /** The first build plan, not yet opened. */
  firstVersion: {
    ...quietFacts,
    documents: [
      { id: "build_plan", title: "Build plan", version: 1, seen: false },
    ],
  },
  /** Everything opened, and the app running. */
  appRunning: {
    ...quietFacts,
    documents: [
      { id: "build_plan", title: "Build plan", version: 1, seen: true },
    ],
    app: "running",
  },
  /** The app running, seen from the open project. */
  appRunningOpen: {
    ...quietFacts,
    app: "running",
    projectOpen: true,
  },
  /** The app running while the box asks to publish it. */
  appRunningAsking: { ...quietFacts, app: "running", asking: true },
  /** A specialist at work while the box asks the person something it needs. */
  writingAsking: {
    ...quietFacts,
    working: [{ runId: "run-writer", doing: "Writing the problem brief" }],
    asking: true,
  },
  /** The app could not start. */
  appFailed: { ...quietFacts, app: "failed" },
  /** The app is still starting, which says nothing on its own. */
  appStarting: { ...quietFacts, app: "starting" },
} satisfies Record<string, RoomStatusFacts>;

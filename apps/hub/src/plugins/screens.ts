import type { Context } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import { getLogger } from "@intx/log";
import type {
  Fact,
  ProjectRead,
  RunRead,
  StepStatus,
} from "@corbits-builder/plugin";
import type { Catalog } from "@corbits-builder/plugin-host/catalog";
import { readyPlanOffers } from "@corbits-builder/plugin-host/plan";
import type { ProjectRun } from "@corbits-builder/schemas/artifact";
import {
  showsScreen,
  type ConversationQuestion,
} from "@corbits-builder/schemas/conversation";
import type {
  AskedScreen,
  PlanView,
  ShownScreen,
} from "@corbits-builder/schemas/project";
import {
  readProjectValues,
  type ProjectState,
} from "../values/project-values.ts";
import { saveValues, type ValueStores } from "../values/save.ts";
import { COORDINATOR_NOT_RUNNING_TEXT } from "../config/answers.ts";
import { ProjectError } from "../projects/errors.ts";

const log = getLogger(["corbits-builder", "hub", "screens"]);

const statusOf = (
  step: {
    id: string;
    title: string;
    plugin: string;
    action: string;
    state: StepStatus["state"];
    summary?: string;
  },
  plan: string | undefined,
): StepStatus => ({
  id: step.id,
  title: step.title,
  plugin: step.plugin,
  action: step.action,
  plan,
  state: step.state,
  summary: step.summary,
});

const runRead = (run: ProjectRun): RunRead => ({
  plugin: run.plugin,
  action: run.action,
  status: run.status,
  startedAt: run.startedAt,
  endedAt: run.endedAt,
  blocked: run.blocked?.reason,
});

/** What the hub read of the project, as a screen's state and a task read it. */
export type ReadProject = {
  state: ProjectState;
  facts: ReadonlySet<Fact>;
  steps: PlanView["steps"];
  now: number;
  appVersion: string | undefined;
  coordinator: ProjectRead["coordinator"];
  runs: readonly ProjectRun[];
  asking: ProjectRead["asking"];
  // Whether the reader may manage the project, which a private value needs.
  manages: boolean;
};

export function projectRead(catalog: Catalog, read: ReadProject): ProjectRead {
  const offers = readyPlanOffers(catalog);
  return {
    value: (name) =>
      readProjectValues([name], read.state, catalog.values, read.manages)[name],
    facts: read.facts,
    plan: read.steps.flatMap((step) =>
      "steps" in step
        ? step.steps.map((child) => statusOf(child, step.plan))
        : [statusOf(step, undefined)],
    ),
    planned: read.steps.flatMap((step) =>
      "steps" in step && step.plan !== undefined
        ? [{ plan: step.plan, state: step.state, finished: step.finished }]
        : [],
    ),
    now: read.now,
    app: { version: read.appVersion },
    coordinator: read.coordinator,
    runs: read.runs.map(runRead),
    asking: read.asking,
    plans: (group) => offers.filter(({ groups }) => groups.includes(group)),
  };
}

// A screen re-read sooner than this would read the project again and again for a clock that has
// barely moved.
const SOONEST_REREAD_MS = 1000;

export const shownScreens = (
  catalog: Catalog,
  project: ProjectRead,
): ShownScreen[] =>
  catalog.shown.flatMap(
    ({ plugin, action, render, state, changesAt, status }) => {
      // One plugin's failing screen must not cost the person the plan and every other screen, and
      // a failing part of a screen costs only that part.
      const tried = <T>(part: string, run: () => T): T | undefined => {
        try {
          return run();
        } catch (error) {
          log.error(`A screen's ${part} failed`, { plugin, action, error });
          return undefined;
        }
      };
      const drawn = tried("state", () => state(project));
      if (drawn === undefined) return [];
      const shown: ShownScreen = { plugin, action, render, state: drawn };
      const changes = tried("changesAt", () => changesAt?.(project));
      if (changes !== undefined && Number.isFinite(changes))
        shown.changesIn = Math.max(SOONEST_REREAD_MS, changes - project.now);
      const stands = tried("status", () => status?.(drawn));
      if (stands !== undefined) shown.status = stands;
      return [shown];
    },
  );

/**
 * What the hub prepares for each question's screen that prepares from the project, open or
 * answered. One that fails leaves only its own question unprepared.
 */
export function askedScreens(
  catalog: Catalog,
  project: ProjectRead,
  questions: readonly ConversationQuestion[],
): AskedScreen[] {
  return questions.flatMap((question) => {
    if (question.status === "closed" || !showsScreen(question)) return [];
    const { plugin, action, input } = question.asked;
    const screen = catalog.screens.find(
      (each) => each.plugin === plugin && each.action === action,
    );
    if (screen?.fromProject === undefined) return [];
    try {
      const data = screen.fromProject(input, project);
      return [{ signalName: question.signalName, data }];
    } catch (error) {
      log.error("A question's screen could not be prepared", {
        plugin,
        action,
        error,
      });
      return [];
    }
  });
}

export async function runTask(
  c: Context<TenantEnv>,
  projectId: string,
  catalog: Catalog,
  ran: {
    task: Catalog["tasks"][number];
    read: ProjectRead;
    input: unknown;
    // How to tell the project's coordinator a note, or undefined while none is running.
    teller: () => Promise<((note: string) => Promise<void>) | undefined>;
  },
  stores: ValueStores,
  nativeFetch?: (request: Request) => Promise<Response>,
) {
  const { name, definition } = ran.task;
  const done = definition.run(ran.read, ran.input);
  const unwritten = done.saves.find(
    (save) => !definition.writes.includes(save.name),
  );
  if (unwritten !== undefined)
    throw new Error(`${name} saves ${unwritten.name}, which it does not write`);
  // A press whose note no coordinator can take would be saved and then go unheard.
  const tell = done.note === undefined ? undefined : await ran.teller();
  if (done.note !== undefined && tell === undefined)
    throw new ProjectError(409, "coordinator_not_running", {
      text: COORDINATOR_NOT_RUNNING_TEXT,
    });
  await saveValues(
    c,
    projectId,
    Object.fromEntries(done.saves.map((save) => [save.name, save.value])),
    catalog.values,
    stores,
    nativeFetch,
  );
  if (done.note !== undefined) await tell?.(done.note);
}

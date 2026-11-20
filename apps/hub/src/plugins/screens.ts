import type { Context } from "hono";
import type { TenantEnv } from "@intx/hub-api";
import { getLogger } from "@intx/log";
import {
  valueIn,
  type Fact,
  type ProjectRead,
  type StepStatus,
  type Value,
} from "@corbits-builder/plugin";
import {
  isReadyPlan,
  isWorkflowAction,
  type Catalog,
} from "@corbits-builder/plugin-host/catalog";
import type { PlanView, ShownScreen } from "@corbits-builder/schemas/project";
import {
  readProjectValues,
  type ProjectState,
} from "../values/project-values.ts";
import { saveValues, type ValueStores } from "../values/save.ts";

const log = getLogger(["corbits-builder", "hub", "screens"]);

const statusOf = (
  step: {
    plugin: string;
    action: string;
    state: StepStatus["state"];
    summary?: string;
  },
  plan: string | undefined,
): StepStatus => ({
  plugin: step.plugin,
  action: step.action,
  plan,
  state: step.state,
  summary: step.summary,
});

/** A typed read of one declared value from what the project stored, or undefined while unset. */
export const valueOf =
  (declared: Catalog["values"], state: ProjectState) => (value: Value) =>
    valueIn(readProjectValues([value.name], state, declared), value);

/**
 * The project as a screen's state and a task read it: its values, saved app, facts, plan and
 * ready-made plans.
 */
export function projectRead(
  catalog: Catalog,
  state: ProjectState,
  appVersion: string | undefined,
  facts: ReadonlySet<Fact>,
  steps: PlanView["steps"],
): ProjectRead {
  return {
    value: valueOf(catalog.values, state),
    appVersion,
    confirm: (plugin, action) =>
      catalog.actions
        .filter(isWorkflowAction)
        .find((each) => each.plugin === plugin && each.action === action)
        ?.confirm,
    facts,
    plan: steps.flatMap((step) =>
      "steps" in step
        ? step.steps.map((child) => statusOf(child, step.plan))
        : [statusOf(step, undefined)],
    ),
    plans: (group) =>
      catalog.plugins
        .filter(isReadyPlan)
        .filter(({ builder }) => builder.groups.includes(group))
        .map(({ builder, description }) => ({
          handle: builder.handle,
          about: description === "" ? builder.when : description,
          when: builder.when,
        })),
  };
}

/** Each screen to show now, in its place, with what its state says it draws. */
export const shownScreens = (
  catalog: Catalog,
  project: ProjectRead,
): ShownScreen[] =>
  catalog.shown.flatMap(({ plugin, action, render, state }) => {
    let drawn: unknown;
    // One plugin's failing screen must not cost the person the plan and every other screen.
    try {
      drawn = state(project);
    } catch (error) {
      log.error("A screen's state failed", { plugin, action, error });
      return [];
    }
    return drawn === undefined
      ? []
      : [{ plugin, action, render, state: drawn }];
  });

/** Runs a person's task on the project and saves the values it returns, each one it writes. */
export async function runTask(
  c: Context<TenantEnv>,
  projectId: string,
  catalog: Catalog,
  ran: { task: Catalog["tasks"][number]; read: ProjectRead; input: unknown },
  stores: ValueStores,
  nativeFetch?: (request: Request) => Promise<Response>,
) {
  const { task } = ran;
  const done = task.run(ran.read, ran.input);
  const unwritten = done.saves.find((save) => !task.writes.has(save.name));
  if (unwritten !== undefined)
    throw new Error(
      `${task.name} saves ${unwritten.name}, which it does not write`,
    );
  await saveValues(
    c,
    projectId,
    Object.fromEntries(done.saves.map((save) => [save.name, save.value])),
    catalog.values,
    stores,
    nativeFetch,
  );
  return done;
}

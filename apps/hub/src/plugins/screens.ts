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
    const drawn = state(project);
    return drawn === undefined
      ? []
      : [{ plugin, action, render, state: drawn }];
  });

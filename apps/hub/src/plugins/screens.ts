import type { Fact, ProjectRead, StepStatus } from "@corbits-builder/plugin";
import type { Catalog } from "@corbits-builder/plugin-host/catalog";
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

/** The project as a screen's state and a task read it: its values, facts and plan. */
export function projectRead(
  catalog: Catalog,
  state: ProjectState,
  facts: ReadonlySet<Fact>,
  steps: PlanView["steps"],
): ProjectRead {
  return {
    value: (name) => readProjectValues([name], state, catalog.values)[name],
    facts,
    plan: steps.flatMap((step) =>
      "steps" in step
        ? step.steps.map((child) => statusOf(child, step.plan))
        : [statusOf(step, undefined)],
    ),
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

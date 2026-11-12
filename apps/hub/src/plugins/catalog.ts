import { type, type Type } from "arktype";
import {
  Builder,
  checkInput,
  checkWorkflowInput,
  guidanceText,
  inputText,
  RouteBuilder,
  SpecialistBuilder,
  type Fact,
  type Field,
  type ProjectValues,
  type Screen,
  type ToolActionBuilder,
  type Workflow,
  type WorkflowActionBuilder,
} from "@corbits-builder/plugin";
import pickFonts from "@corbits-builder/pick-fonts";
import fonts from "@corbits-builder/pick-fonts/data";
import { Fonts } from "@corbits-builder/pick-fonts/schema";
import pickColours from "@corbits-builder/pick-colours";
import reviewMockup from "@corbits-builder/review-mockup";
import build from "@corbits-builder/coder-plugin/build";
import change from "@corbits-builder/coder-plugin/change";
import designApp from "@corbits-builder/design-app";
import review from "@corbits-builder/writer-plugin/review";
import writeBuildPlan from "@corbits-builder/writer-plugin/write-build-plan";
import writeRequirements from "@corbits-builder/writer-plugin/write-requirements";
import { guidance as buildWebAppGuidance } from "@corbits-builder/build-web-app/guidance" with { type: "macro" };
// Relative imports, because the plugins' exports do not include their package.json.
import pickFontsManifest from "../../../../plugins/pick-fonts/package.json";
import pickColoursManifest from "../../../../plugins/pick-colours/package.json";
import reviewMockupManifest from "../../../../plugins/review-mockup/package.json";
import coderManifest from "../../../../plugins/coder/package.json";
import designAppManifest from "../../../../plugins/design-app/package.json";
import writerManifest from "../../../../plugins/writer/package.json";
import buildWebAppManifest from "../../../../plugins/build-web-app/package.json";
import { unregisteredValue } from "../artifacts/project-values.ts";
import { requiresText } from "../config/execute.ts";
import { FACTS, templateField } from "./facts.ts";
import * as runners from "./runners.ts";
import type { ProjectSession } from "../projects/project-session.ts";

const Manifest = <B>(builder: Type<B>) =>
  type({ "description?": "string", builder });

type Base = {
  description: string;
  // What the coordinator reads to use it.
  guidance: string;
};
export type ScreenPlugin = Base & {
  builder: Builder;
  // Why this input cannot be shown, or undefined when it can.
  refusal: (input: unknown, project: ProjectValues) => string | undefined;
};

// The input checked for the runner, or the refusal text when it is wrong.
type Checked =
  | {
      ok: true;
      input: unknown;
      start: (session: ProjectSession) => Promise<unknown>;
    }
  | { ok: false; text: string };

// What a specialist's package defines for a workflow action, with the runner that starts it.
type Runnable = {
  summary: string;
  fields: Record<string, Field>;
  // name is how refusals name the action, such as "coder change".
  check: (name: string, input: unknown) => Checked;
};

type ActionBase = Base & {
  plugin: string;
  action: string;
  // How the coordinator's messages name it, such as "coder change".
  name: string;
};
export type WorkflowAction = ActionBase & {
  builder: WorkflowActionBuilder;
  check: (input: unknown) => Checked;
};
export type ToolAction = ActionBase & { builder: ToolActionBuilder };
export type Action = WorkflowAction | ToolAction;

export type SpecialistPlugin = Base & {
  builder: SpecialistBuilder;
  actions: readonly Action[];
};
export type RoutePlugin = Base & { builder: RouteBuilder };
export type Plugin = ScreenPlugin | SpecialistPlugin | RoutePlugin;

const lines = (
  name: string,
  { when, unless }: { when: string; unless: string },
  summary: string,
) => [`${name}: ${summary}`, `Use it when: ${when}`, `Not when: ${unless}`];

export function screenPlugin<In, Out, Data, Prepared>(
  manifest: unknown,
  screen: Screen<In, Out, Data, Prepared>,
  data: Type<Data>["infer"],
): ScreenPlugin {
  const { builder } = Manifest(Builder).assert(manifest);
  const unknown = unregisteredValue([
    ...(builder.reads ?? []),
    ...(builder.writes ?? []),
  ]);
  if (unknown !== undefined)
    throw new Error(
      `${builder.handle} names ${unknown}, which is not a registered project value`,
    );
  return {
    builder,
    description: screen.describe.summary,
    guidance: guidanceText(builder.handle, screen, builder.reads ?? []),
    refusal(input, project) {
      const checked = checkInput(builder.handle, screen, input, data, project);
      return checked.ok ? undefined : checked.text;
    },
  };
}

// Refuses a fact that is neither one Builder works out nor a template on a field the plugin takes.
function checkFacts(
  handle: string,
  facts: readonly Fact[],
  takes: (field: string) => boolean,
) {
  const unknown = facts.find((fact) => {
    const field = templateField(fact);
    return field === undefined ? !FACTS.has(fact) : !takes(field);
  });
  if (unknown !== undefined)
    throw new Error(
      `${handle} names ${unknown}, which is not a fact Builder knows`,
    );
}

/** A workflow action as its specialist's package defines it, with the runner that starts it. */
export const workflowAction = <In>(
  workflow: Workflow<In>,
  start: runners.Runner<Type<In>["infer"]>,
): Runnable => ({
  summary: workflow.describe.summary,
  fields: workflow.describe.fields,
  check(name, raw) {
    const checked = checkWorkflowInput(name, workflow, raw);
    if (!checked.ok) return checked;
    const { input } = checked;
    return { ok: true, input, start: (session) => start(input, session) };
  },
});

function installAction(
  handle: string,
  action: string,
  declared: SpecialistBuilder["actions"][string],
  workflow: Runnable | undefined,
): Action {
  const name = `${handle} ${action}`;
  const facts = [...(declared.requires ?? []).flat(), ...declared.returns];
  const requires = `Requires: ${requiresText(declared.requires ?? [])}.`;
  if (declared.runs === "tool") {
    // The input is its own tool's, which the hub defines, so any field may be templated.
    checkFacts(name, facts, () => true);
    return {
      plugin: handle,
      action,
      name,
      builder: declared,
      description: declared.summary,
      guidance: [...lines(name, declared, declared.summary), requires].join(
        "\n",
      ),
    };
  }
  if (!workflow) throw new Error(`${name} has no workflow installed`);
  checkFacts(name, facts, (field) => Object.hasOwn(workflow.fields, field));
  return {
    plugin: handle,
    action,
    name,
    builder: declared,
    description: workflow.summary,
    guidance: [
      ...lines(name, declared, workflow.summary),
      requires,
      inputText(workflow.fields),
    ].join("\n"),
    check: (raw) => workflow.check(name, raw),
  };
}

/** A specialist and its actions, each workflow action started by the runnable given under its name. */
export function specialistPlugin(
  manifest: unknown,
  workflows: Readonly<Record<string, Runnable>>,
): SpecialistPlugin {
  const { builder, description = "" } =
    Manifest(SpecialistBuilder).assert(manifest);
  const { handle } = builder;
  for (const name of Object.keys(workflows))
    if (builder.actions[name]?.runs !== "workflow")
      throw new Error(`${handle} has no workflow action ${name}`);
  const actions = Object.entries(builder.actions).map(([name, declared]) =>
    installAction(handle, name, declared, workflows[name]),
  );
  return {
    builder,
    description,
    actions,
    guidance: [
      ...lines(handle, builder, description),
      `Start one of its actions with execute({ plugin: "${handle}", action, input }), with the input that action describes; an action started with a tool of its own says so.`,
      ...actions.flatMap(({ guidance }) => ["", guidance]),
    ].join("\n"),
  };
}

export function routePlugin(manifest: unknown, guidance: string): RoutePlugin {
  const { builder, description = "" } = Manifest(RouteBuilder).assert(manifest);
  checkFacts(
    builder.handle,
    [...builder.steps.flatMap((step) => step.requires), builder.outcome],
    () => false,
  );
  return {
    builder,
    description,
    guidance: [
      ...lines(builder.handle, builder, description),
      "",
      guidance.trim(),
    ].join("\n"),
  };
}

/** The installed plugins, every action a route names among them; checked once when the hub loads. */
export function catalog(plugins: readonly Plugin[]): readonly Plugin[] {
  const handles = new Set<string>();
  for (const { builder } of plugins) {
    if (handles.has(builder.handle))
      throw new Error(`${builder.handle} is installed twice`);
    handles.add(builder.handle);
  }
  const started = plugins
    .filter(isSpecialist)
    .flatMap(({ actions }) => actions.filter(isWorkflowAction))
    .map(({ name }) => name);
  for (const { builder } of plugins)
    if (builder.runs === "route")
      for (const step of builder.steps)
        if (!started.includes(`${step.plugin} ${step.action}`))
          throw new Error(
            `${builder.handle} names ${step.plugin} ${step.action}, which is not an installed workflow action`,
          );
  return plugins;
}

export const isScreen = (plugin: Plugin): plugin is ScreenPlugin =>
  plugin.builder.runs === "screen";
export const isSpecialist = (plugin: Plugin): plugin is SpecialistPlugin =>
  plugin.builder.runs === "specialist";
export const isRoute = (plugin: Plugin): plugin is RoutePlugin =>
  plugin.builder.runs === "route";
export const isWorkflowAction = (action: Action): action is WorkflowAction =>
  action.builder.runs === "workflow";

export const PLUGINS = catalog([
  screenPlugin(pickFontsManifest, pickFonts, Fonts.assert(fonts)),
  screenPlugin(pickColoursManifest, pickColours, undefined),
  screenPlugin(reviewMockupManifest, reviewMockup, undefined),
  specialistPlugin(writerManifest, {
    "write-requirements": workflowAction(
      writeRequirements,
      runners.writeRequirements,
    ),
    "write-build-plan": workflowAction(writeBuildPlan, runners.writeBuildPlan),
    review: workflowAction(review, runners.reviewDocument),
  }),
  specialistPlugin(designAppManifest, {
    design: workflowAction(designApp, runners.designApp),
  }),
  specialistPlugin(coderManifest, {
    build: workflowAction(build, runners.buildApp),
    change: workflowAction(change, runners.changeApp),
  }),
  routePlugin(buildWebAppManifest, buildWebAppGuidance()),
]);

// The screens a question can show.
export const SCREENS = PLUGINS.filter(isScreen);

// Every action of every specialist, each started with execute or its own tool.
export const ACTIONS = PLUGINS.filter(isSpecialist).flatMap(
  ({ actions }) => actions,
);

// The route a project follows, as the hub stores it: a route plugin's handle, or null for none.
export const ProjectRoute = type({ "+": "reject", route: "string > 0 | null" });

export const installed = (handle: string) =>
  PLUGINS.find((plugin) => plugin.builder.handle === handle);

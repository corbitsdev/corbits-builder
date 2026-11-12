import { type, type Type } from "arktype";
import {
  Builder,
  checkInput,
  checkWorkflowInput,
  guidanceText,
  inputText,
  PluginBuilder,
  RouteBuilder,
  ToolBuilder,
  WorkflowBuilder,
  type Fact,
  type ProjectValues,
  type Screen,
  type Workflow,
} from "@corbits-builder/plugin";
import pickFonts from "@corbits-builder/pick-fonts";
import fonts from "@corbits-builder/pick-fonts/data";
import { Fonts } from "@corbits-builder/pick-fonts/schema";
import pickColours from "@corbits-builder/pick-colours";
import reviewMockup from "@corbits-builder/review-mockup";
import buildApp from "@corbits-builder/build-app";
import changeApp from "@corbits-builder/change-app";
import designApp from "@corbits-builder/design-app";
import reviewDocument from "@corbits-builder/review-document";
import writeBuildPlan from "@corbits-builder/write-build-plan";
import writeRequirements from "@corbits-builder/write-requirements";
import { guidance as buildWebAppGuidance } from "@corbits-builder/build-web-app/guidance" with { type: "macro" };
// Relative imports, because the plugins' exports do not include their package.json.
import pickFontsManifest from "../../../../plugins/pick-fonts/package.json";
import pickColoursManifest from "../../../../plugins/pick-colours/package.json";
import reviewMockupManifest from "../../../../plugins/review-mockup/package.json";
import buildAppManifest from "../../../../plugins/build-app/package.json";
import changeAppManifest from "../../../../plugins/change-app/package.json";
import designAppManifest from "../../../../plugins/design-app/package.json";
import reviewDocumentManifest from "../../../../plugins/review-document/package.json";
import writeBuildPlanManifest from "../../../../plugins/write-build-plan/package.json";
import writeRequirementsManifest from "../../../../plugins/write-requirements/package.json";
import approveDocumentManifest from "../../../../plugins/approve-document/package.json";
import buildWebAppManifest from "../../../../plugins/build-web-app/package.json";
import { unregisteredValue } from "../artifacts/project-values.ts";
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
export type WorkflowPlugin = Base & {
  builder: WorkflowBuilder;
  // The input checked for the runner, or the refusal text when it is wrong.
  check: (input: unknown) =>
    | {
        ok: true;
        input: unknown;
        start: (session: ProjectSession) => Promise<unknown>;
      }
    | { ok: false; text: string };
};
export type RoutePlugin = Base & { builder: RouteBuilder };
export type ToolPlugin = Base & { builder: ToolBuilder };
export type Plugin = ScreenPlugin | WorkflowPlugin | RoutePlugin | ToolPlugin;

const lines = (builder: PluginBuilder, summary: string) => [
  `${builder.handle}: ${summary}`,
  `Use it when: ${builder.when}`,
  `Not when: ${builder.unless}`,
];

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

export function workflowPlugin<In>(
  manifest: unknown,
  workflow: Workflow<In>,
  start: runners.Runner<Type<In>["infer"]>,
): WorkflowPlugin {
  const { builder } = Manifest(WorkflowBuilder).assert(manifest);
  const fields = Object.keys(workflow.describe.fields);
  checkFacts(
    builder.handle,
    [...(builder.requires ?? []).flat(), ...builder.returns],
    (field) => fields.includes(field),
  );
  return {
    builder,
    description: workflow.describe.summary,
    guidance: [
      ...lines(builder, workflow.describe.summary),
      "",
      inputText(workflow.describe.fields),
    ].join("\n"),
    check(raw) {
      const checked = checkWorkflowInput(builder.handle, workflow, raw);
      if (!checked.ok) return checked;
      const { input } = checked;
      return { ok: true, input, start: (session) => start(input, session) };
    },
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
    guidance: [...lines(builder, description), "", guidance.trim()].join("\n"),
  };
}

export function toolPlugin(manifest: unknown): ToolPlugin {
  const { builder, description = "" } = Manifest(ToolBuilder).assert(manifest);
  // The input is its own tool's, which the hub defines, so any field may be templated.
  checkFacts(
    builder.handle,
    [...(builder.requires ?? []).flat(), ...builder.returns],
    () => true,
  );
  return {
    builder,
    description,
    guidance: lines(builder, description).join("\n"),
  };
}

/** The installed plugins, every handle a route names among them; checked once when the hub loads. */
export function catalog(plugins: readonly Plugin[]): readonly Plugin[] {
  const handles = new Set<string>();
  for (const { builder } of plugins) {
    if (handles.has(builder.handle))
      throw new Error(`${builder.handle} is installed twice`);
    handles.add(builder.handle);
  }
  for (const { builder } of plugins)
    if (builder.runs === "route")
      for (const step of builder.steps)
        if (!handles.has(step.plugin))
          throw new Error(
            `${builder.handle} names ${step.plugin}, which is not an installed plugin`,
          );
  return plugins;
}

export const PLUGINS = catalog([
  screenPlugin(pickFontsManifest, pickFonts, Fonts.assert(fonts)),
  screenPlugin(pickColoursManifest, pickColours, undefined),
  screenPlugin(reviewMockupManifest, reviewMockup, undefined),
  workflowPlugin(
    writeRequirementsManifest,
    writeRequirements,
    runners.writeRequirements,
  ),
  workflowPlugin(designAppManifest, designApp, runners.designApp),
  workflowPlugin(
    writeBuildPlanManifest,
    writeBuildPlan,
    runners.writeBuildPlan,
  ),
  workflowPlugin(buildAppManifest, buildApp, runners.buildApp),
  workflowPlugin(changeAppManifest, changeApp, runners.changeApp),
  workflowPlugin(
    reviewDocumentManifest,
    reviewDocument,
    runners.reviewDocument,
  ),
  toolPlugin(approveDocumentManifest),
  routePlugin(buildWebAppManifest, buildWebAppGuidance()),
]);

export const isScreen = (plugin: Plugin): plugin is ScreenPlugin =>
  plugin.builder.runs === "screen";
export const isWorkflow = (plugin: Plugin): plugin is WorkflowPlugin =>
  plugin.builder.runs === "workflow";
export const isRoute = (plugin: Plugin): plugin is RoutePlugin =>
  plugin.builder.runs === "route";
export const isTool = (plugin: Plugin): plugin is ToolPlugin =>
  plugin.builder.runs === "tool";
// A plugin whose requirements Builder checks before its work starts.
export type Startable = WorkflowPlugin | ToolPlugin;
export const isStartable = (plugin: Plugin): plugin is Startable =>
  isWorkflow(plugin) || isTool(plugin);

// The screens a question can show.
export const SCREENS = PLUGINS.filter(isScreen);

// The route a project follows, as the hub stores it: a route plugin's handle, or null for none.
export const ProjectRoute = type({ "+": "reject", route: "string > 0 | null" });

export const installed = (handle: string) =>
  PLUGINS.find((plugin) => plugin.builder.handle === handle);

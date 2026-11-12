import { type } from "arktype";
import {
  Builder,
  checkInput,
  checkWorkflowInput,
  guidanceText,
  inputText,
  isScreen as isScreenModule,
  isWorkflow,
  RouteBuilder,
  SpecialistBuilder,
  type Fact,
  type ProjectValues,
  type Refused,
  type ToolActionBuilder,
  type WorkflowActionBuilder,
} from "@corbits-builder/plugin";
import { patternFact, templateField } from "./facts.ts";
import type { Found } from "./folder.ts";
import { requiresText } from "./text.ts";

/** What a host supplies the catalog: all it needs that the plugins themselves cannot say. */
export type Host = {
  // Every fact the host works out from what it stores.
  facts: ReadonlySet<Fact>;
  // The first of these names that is not a project value the host stores, or undefined.
  unknownValue(names: readonly string[]): string | undefined;
  // How the host starts workflow actions, by the workflow a manifest's start block names.
  starters: Readonly<Record<string, Starter>>;
};

export type Starter = {
  // Why a start block is wrong for this starter, or undefined when it takes it.
  check(start: WorkflowActionBuilder["start"]): string | undefined;
  // The input fields it reads, which every action it starts must take.
  reads: readonly string[];
};

// The builder block of whichever kind the manifest says it runs.
const Manifest = type({
  "description?": "string",
  builder: Builder.or(SpecialistBuilder).or(RouteBuilder),
});

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

type ActionBase = Base & {
  plugin: string;
  action: string;
  // How the coordinator's messages name it, such as "coder change".
  name: string;
};
export type WorkflowAction = ActionBase & {
  builder: WorkflowActionBuilder;
  // The input checked for the host's starter, or the refusal when it is wrong.
  check: (input: unknown) => { ok: true; input: unknown } | Refused;
};
export type ToolAction = ActionBase & { builder: ToolActionBuilder };
export type Action = WorkflowAction | ToolAction;

export type SpecialistPlugin = Base & {
  builder: SpecialistBuilder;
  actions: readonly Action[];
};
export type RoutePlugin = Base & { builder: RouteBuilder };
export type Plugin = ScreenPlugin | SpecialistPlugin | RoutePlugin;

export type Catalog = {
  plugins: readonly Plugin[];
  // The screens a question can show.
  screens: readonly ScreenPlugin[];
  // Every action of every specialist, each started with execute or its own tool.
  actions: readonly Action[];
  installed(handle: string): Plugin | undefined;
  // A fact in plain words.
  factText(fact: Fact): string;
};

export const isScreen = (plugin: Plugin): plugin is ScreenPlugin =>
  plugin.builder.runs === "screen";
export const isSpecialist = (plugin: Plugin): plugin is SpecialistPlugin =>
  plugin.builder.runs === "specialist";
export const isRoute = (plugin: Plugin): plugin is RoutePlugin =>
  plugin.builder.runs === "route";
export const isWorkflowAction = (action: Action): action is WorkflowAction =>
  action.builder.runs === "workflow";

const lines = (
  name: string,
  { when, unless }: { when: string; unless: string },
  summary: string,
) => [`${name}: ${summary}`, `Use it when: ${when}`, `Not when: ${unless}`];

// The plugin a folder holds, refused with the folder and field when its manifest is wrong.
function manifestOf(found: Found) {
  const manifest = Manifest(found.manifest);
  if (manifest instanceof type.errors)
    throw new Error(
      `plugins/${found.folder}/package.json: ${manifest.summary}`,
    );
  const { builder, description = "" } = manifest;
  return { found, builder, description };
}
type Manifested = ReturnType<typeof manifestOf>;

/** The files a plugin's manifest names: the modules the catalog imports and the texts it reads. */
export function manifestFiles(found: Found) {
  const { builder } = manifestOf(found);
  if (builder.runs === "screen")
    return {
      modules:
        builder.data === undefined
          ? [builder.screen]
          : [builder.screen, builder.data],
      texts: [],
    };
  if (builder.runs === "specialist")
    return {
      modules: Object.values(builder.actions).flatMap((action) =>
        action.runs === "workflow" ? [action.input] : [],
      ),
      texts: [],
    };
  return { modules: [], texts: [builder.guidance] };
}

// Refuses a fact that is neither one the host works out nor a template on a field the plugin takes.
function checkFacts(
  name: string,
  facts: readonly Fact[],
  known: ReadonlySet<Fact>,
  takes: (field: string) => boolean,
) {
  const unknown = facts.find((fact) => {
    const field = templateField(fact);
    return field === undefined ? !known.has(fact) : !takes(field);
  });
  if (unknown !== undefined)
    throw new Error(
      `${name} names ${unknown}, which is not a fact Builder knows`,
    );
}

// Each fact in the words of the one plugin that describes it. Every fact the host works out has
// words, except a fact about one kind of document, which reads well enough from the kind.
function factWords(manifests: readonly Manifested[], known: ReadonlySet<Fact>) {
  const words = new Map<Fact, { handle: string; text: string }>();
  for (const { builder } of manifests)
    for (const [fact, text] of Object.entries(builder.facts ?? {})) {
      if (!known.has(fact))
        throw new Error(
          `${builder.handle} describes ${fact}, which is not a fact Builder knows`,
        );
      const other = words.get(fact);
      if (other)
        throw new Error(
          `${builder.handle} describes ${fact}, which ${other.handle} describes too`,
        );
      words.set(fact, { handle: builder.handle, text });
    }
  for (const fact of known)
    if (!patternFact(fact) && !words.has(fact))
      throw new Error(`Builder works out ${fact}, but no plugin describes it`);
  return (fact: Fact): string => {
    const described = words.get(fact)?.text;
    if (described !== undefined) return described;
    const field = templateField(fact);
    const pattern = patternFact(fact);
    if (field !== undefined)
      return fact.startsWith("filed:")
        ? `each document named in ${field} is filed`
        : `the person approved each document named in ${field}`;
    if (pattern === undefined) throw new Error(`No plugin describes ${fact}`);
    return pattern.state === "filed"
      ? `the ${pattern.kind} document is filed`
      : `the person approved the current version of the ${pattern.kind} document, or leaves approvals to you`;
  };
}

async function screenPlugin(
  found: Found,
  builder: Builder,
  host: Host,
): Promise<ScreenPlugin> {
  const unknown = host.unknownValue([
    ...(builder.reads ?? []),
    ...(builder.writes ?? []),
  ]);
  if (unknown !== undefined)
    throw new Error(
      `${builder.handle} names ${unknown}, which is not a registered project value`,
    );
  const screen = await found.module(builder.screen);
  if (!isScreenModule(screen))
    throw new Error(
      `${builder.handle}'s screen ${builder.screen} has no screen as its default export`,
    );
  let data: unknown;
  if (builder.data !== undefined) {
    if (!screen.data)
      throw new Error(
        `${builder.handle} names data ${builder.data}, but its screen declares no data schema`,
      );
    data = screen.data.assert(await found.module(builder.data));
  }
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

async function installAction(
  found: Found,
  handle: string,
  action: string,
  declared: SpecialistBuilder["actions"][string],
  host: Host,
  factText: (fact: Fact) => string,
): Promise<Action> {
  const name = `${handle} ${action}`;
  const facts = [...(declared.requires ?? []).flat(), ...declared.returns];
  const requires = () =>
    `Requires: ${requiresText(declared.requires ?? [], factText)}.`;
  if (declared.runs === "tool") {
    // The input is its own tool's, which the host defines, so any field may be templated.
    checkFacts(name, facts, host.facts, () => true);
    return {
      plugin: handle,
      action,
      name,
      builder: declared,
      description: declared.summary,
      guidance: [...lines(name, declared, declared.summary), requires()].join(
        "\n",
      ),
    };
  }
  const workflow = await found.module(declared.input);
  if (!isWorkflow(workflow))
    throw new Error(
      `${name}'s input ${declared.input} has no workflow as its default export`,
    );
  const { fields } = workflow.describe;
  checkFacts(name, facts, host.facts, (field) => Object.hasOwn(fields, field));
  const starter = host.starters[declared.start.workflow];
  if (!starter)
    throw new Error(
      `${name} starts ${declared.start.workflow}, which is not an installed workflow`,
    );
  const problem = starter.check(declared.start);
  if (problem !== undefined) throw new Error(`${name} start: ${problem}`);
  const unread = starter.reads.find((field) => !Object.hasOwn(fields, field));
  if (unread !== undefined)
    throw new Error(
      `${name} starts ${declared.start.workflow}, which reads ${unread}, but its input has no ${unread}`,
    );
  return {
    plugin: handle,
    action,
    name,
    builder: declared,
    description: workflow.describe.summary,
    guidance: [
      ...lines(name, declared, workflow.describe.summary),
      requires(),
      inputText(fields),
    ].join("\n"),
    check: (raw) => checkWorkflowInput(name, workflow, raw),
  };
}

async function specialistPlugin(
  found: Found,
  builder: SpecialistBuilder,
  description: string,
  host: Host,
  factText: (fact: Fact) => string,
): Promise<SpecialistPlugin> {
  const { handle } = builder;
  const actions = await Promise.all(
    Object.entries(builder.actions).map(([name, declared]) =>
      installAction(found, handle, name, declared, host, factText),
    ),
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

async function routePlugin(
  found: Found,
  builder: RouteBuilder,
  description: string,
  host: Host,
): Promise<RoutePlugin> {
  checkFacts(
    builder.handle,
    [...builder.steps.flatMap((step) => step.requires), builder.outcome],
    host.facts,
    () => false,
  );
  return {
    builder,
    description,
    guidance: [
      ...lines(builder.handle, builder, description),
      "",
      (await found.text(builder.guidance)).trim(),
    ].join("\n"),
  };
}

// Every handle once, and every action a route names among the installed workflow actions.
function checkCatalog(plugins: readonly Plugin[]) {
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
}

/** The plugins found, each checked against its manifest and the host; a wrong one is thrown. */
export async function loadCatalog(
  found: readonly Found[],
  host: Host,
): Promise<Catalog> {
  const manifests = found.map(manifestOf);
  const factText = factWords(manifests, host.facts);
  const plugins = await Promise.all(
    manifests.map(({ found, builder, description }): Promise<Plugin> => {
      if (builder.runs === "screen") return screenPlugin(found, builder, host);
      if (builder.runs === "specialist")
        return specialistPlugin(found, builder, description, host, factText);
      return routePlugin(found, builder, description, host);
    }),
  );
  checkCatalog(plugins);
  return {
    plugins,
    screens: plugins.filter(isScreen),
    actions: plugins.filter(isSpecialist).flatMap(({ actions }) => actions),
    installed: (handle) =>
      plugins.find((plugin) => plugin.builder.handle === handle),
    factText,
  };
}

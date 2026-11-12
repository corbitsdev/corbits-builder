import { type } from "arktype";
import type { Fact } from "@corbits-builder/plugin";
import {
  isRoute,
  isScreenAction,
  isSpecialist,
  isWorkflowAction,
  type Action,
  type Catalog,
  type Plugin,
  type RoutePlugin,
  type ScreenAction,
  type WorkflowAction,
} from "./catalog.ts";
import { makes, resolveFacts, templateField, unmet } from "./facts.ts";
import { fields } from "./search/fields.ts";
import type { Strategy } from "./search/words.ts";
import {
  assignedValuesText,
  DISCOVER_NEEDS_ONE,
  foundPlugins,
  noPluginFound,
  projectValuesText,
  readinessText,
  routeDone,
  routeFollowed,
  routeInputRefused,
  routeLeft,
  routeTakesNoAction,
  screenNotExecuted,
  toolNotExecuted,
  unknownAction,
  unknownPlugin,
  unmetRequirement,
  type Readiness,
} from "./text.ts";

/** What the coordinator's tools need from the project they act on, which only the host can do. */
export type Project = {
  // What is true of the project, from what the host stores.
  facts(): Promise<ReadonlySet<Fact>>;
  // The handle of the route the project follows, or null for none.
  route(): Promise<string | null>;
  setRoute(handle: string | null): Promise<unknown>;
  // Each named project value as stored, null where the project has none yet.
  values(names: readonly string[]): Promise<Readonly<Record<string, unknown>>>;
  // Starts a workflow action on its checked input, its run's assignment ending with values, the
  // block of project values it reads; what it returns is execute's answer.
  start(
    action: WorkflowAction,
    input: unknown,
    values: string,
  ): Promise<unknown>;
};

// The one place the search is chosen.
const search: Strategy = fields;

const MAX_FOUND = 5;

// One object rather than a union: providers want a tool's input schema to be a plain object.
export const Discover = type({
  "+": "reject",
  "query?": "string > 0",
  "group?": "string > 0",
});
export const Execute = type({
  "+": "reject",
  plugin: "string > 0",
  "action?": "string > 0",
  "input?": "object",
});
const RouteInput = type({ "+": "reject", "leave?": "true" });

const groupsOf = (plugins: readonly Plugin[]) => {
  const groups = new Map<string, Plugin[]>();
  for (const plugin of plugins)
    for (const group of plugin.builder.groups) {
      const members = groups.get(group) ?? [];
      members.push(plugin);
      groups.set(group, members);
    }
  return groups;
};

/** What discover answers from the given plugins. Its tool asks for exactly one of query and group. */
export function discoverIn(
  plugins: readonly Plugin[],
  asked: typeof Discover.infer,
  status?: (plugin: Plugin) => string[],
) {
  const { query, group } = asked;
  const groups = groupsOf(plugins);
  let found: readonly Plugin[] = [];
  if (query !== undefined)
    found = search(query, plugins)
      .slice(0, MAX_FOUND)
      .flatMap(({ handle }) =>
        plugins.filter((plugin) => plugin.builder.handle === handle),
      );
  if (group !== undefined) found = groups.get(group) ?? [];
  if (found.length === 0) return noPluginFound(asked, groups);
  return foundPlugins(found, status);
}

/** discover's arguments, or why they are wrong. */
export function checkedDiscover(raw: unknown) {
  const input = Discover(raw);
  if (input instanceof type.errors) return { error: input.summary };
  if ((input.query === undefined) === (input.group === undefined))
    return { error: DISCOVER_NEEDS_ONE };
  return { input };
}

// What is true of the project, and the route it follows. A route whose outcome holds is left, so
// nothing from it applies after.
async function projectState(catalog: Catalog, project: Project) {
  const facts = await project.facts();
  const handle = await project.route();
  let route = catalog.plugins
    .filter(isRoute)
    .find((plugin) => plugin.builder.handle === handle);
  if (route && facts.has(route.builder.outcome)) {
    await project.setRoute(null);
    route = undefined;
  }
  return { facts, route };
}
type ProjectState = Awaited<ReturnType<typeof projectState>>;

const makersIn = (catalog: Catalog) => (fact: Fact) =>
  catalog.actions
    .filter(
      (action) =>
        !isScreenAction(action) &&
        action.builder.returns.some((made) => makes(made, fact)),
    )
    .map(({ name }) => name);

// Where an action stands: what it lacks of its own requirements, for the input when there is one,
// and what the route the project follows adds for it as a step.
function readiness(
  action: Exclude<Action, ScreenAction>,
  { facts, route }: ProjectState,
  input?: unknown,
): Readiness {
  const requires = (action.builder.requires ?? []).map((alternative) =>
    input === undefined
      ? alternative.filter((fact) => templateField(fact) === undefined)
      : resolveFacts(alternative, input),
  );
  const step = route?.builder.steps.find(
    (named) => named.plugin === action.plugin && named.action === action.action,
  );
  const readied: Readiness = {
    own: unmet(requires, facts),
    fromRoute: (step?.requires ?? []).filter((fact) => !facts.has(fact)),
  };
  if (route && step) readied.route = route.builder.handle;
  return readied;
}

// The installed action that a plugin's handle and an action's name pick out.
const installedAction = (
  catalog: Catalog,
  plugin: string,
  name: string | undefined,
) =>
  catalog.actions.find(
    (action) => action.plugin === plugin && action.action === name,
  );

// Each step of a route as if the project followed it.
const stepsOf = (
  catalog: Catalog,
  route: RoutePlugin,
  facts: ProjectState["facts"],
) =>
  route.builder.steps.map(({ plugin, action: name }) => {
    const action = installedAction(catalog, plugin, name);
    if (!action || !isWorkflowAction(action))
      throw new Error(`${route.builder.handle} names ${plugin} ${name}`);
    return {
      name: action.name,
      readiness: readinessText(
        readiness(action, { facts, route }),
        catalog.factText,
      ),
    };
  });

// What discover adds about each plugin for this project.
function status(
  catalog: Catalog,
  plugin: Plugin,
  state: ProjectState,
): string[] {
  if (isRoute(plugin))
    return [
      state.route === plugin
        ? "This project is following it."
        : "Start it with execute; the project then follows it.",
      "Steps:",
      ...stepsOf(catalog, plugin, state.facts).map(
        ({ name, readiness: line }) => `  ${name}: ${line}`,
      ),
    ];
  if (!isSpecialist(plugin)) return [];
  return [
    "",
    "Now:",
    ...plugin.actions.map(
      (action) =>
        `  ${action.name}: ${isScreenAction(action) ? "can open now" : readinessText(readiness(action, state), catalog.factText)}`,
    ),
  ];
}

/** discover for a project: every plugin it finds, with where each stands for the project. */
export async function discoverFor(
  catalog: Catalog,
  project: Project,
  asked: typeof Discover.infer,
) {
  const state = await projectState(catalog, project);
  const values = await project.values([...catalog.values.keys()]);
  return (
    discoverIn(catalog.plugins, asked, (plugin) =>
      status(catalog, plugin, state),
    ) + projectValuesText(catalog.values, values)
  );
}

export type Outcome = { content: string; isError?: true };

async function followRoute(
  catalog: Catalog,
  project: Project,
  route: RoutePlugin,
  raw: unknown,
  state: ProjectState,
): Promise<Outcome> {
  const { handle, outcome } = route.builder;
  const input = RouteInput(raw);
  if (input instanceof type.errors)
    return { content: routeInputRefused(handle, input.summary), isError: true };
  if (input.leave) {
    if (state.route === route) await project.setRoute(null);
    return { content: routeLeft(handle, state.route === route) };
  }
  if (state.facts.has(outcome))
    return { content: routeDone(handle, outcome, catalog.factText) };
  if (state.route !== route) await project.setRoute(handle);
  return {
    content: routeFollowed(
      handle,
      route.guidance,
      stepsOf(catalog, route, state.facts),
    ),
  };
}

/**
 * Starts a specialist's workflow action, or follows or leaves a route, once its input and
 * requirements hold.
 */
export async function execute(
  catalog: Catalog,
  project: Project,
  raw: unknown,
): Promise<Outcome> {
  const asked = Execute(raw);
  if (asked instanceof type.errors)
    return { content: asked.summary, isError: true };
  const plugin = catalog.installed(asked.plugin);
  if (!plugin)
    return {
      content: unknownPlugin(asked.plugin, [
        ...catalog.actions.filter(isWorkflowAction).map(({ name }) => name),
        ...catalog.plugins.filter(isRoute).map(({ builder }) => builder.handle),
      ]),
      isError: true,
    };
  if (isRoute(plugin)) {
    if (asked.action !== undefined)
      return {
        content: routeTakesNoAction(plugin.builder.handle),
        isError: true,
      };
    const state = await projectState(catalog, project);
    return followRoute(catalog, project, plugin, asked.input ?? {}, state);
  }
  const action = installedAction(catalog, plugin.builder.handle, asked.action);
  if (!action)
    return {
      content: unknownAction(
        plugin.builder.handle,
        asked.action,
        plugin.actions,
      ),
      isError: true,
    };
  if (isScreenAction(action))
    return { content: screenNotExecuted(action), isError: true };
  if (!isWorkflowAction(action))
    return {
      content: toolNotExecuted(action.name, action.builder.tool),
      isError: true,
    };
  const state = await projectState(catalog, project);
  const checked = action.check(asked.input ?? {});
  if (!checked.ok) return { content: checked.text, isError: true };
  const ready = readiness(action, state, checked.input);
  if (ready.own.length > 0 || ready.fromRoute.length > 0)
    return {
      content: unmetRequirement(
        action.name,
        ready,
        makersIn(catalog),
        catalog.factText,
      ),
      isError: true,
    };
  // The hub refuses a read of no names.
  const reads = action.builder.reads ?? [];
  const values =
    reads.length === 0
      ? ""
      : assignedValuesText(catalog.values, await project.values(reads));
  return {
    content: JSON.stringify(await project.start(action, checked.input, values)),
  };
}

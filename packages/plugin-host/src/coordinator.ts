import { setTimeout as sleep } from "node:timers/promises";
import { type } from "arktype";
import type { Fact, Field } from "@corbits-builder/plugin";
import {
  isRoute,
  isScreenAction,
  isSpecialist,
  isWorkflowAction,
  type Catalog,
  type Plugin,
  type RoutePlugin,
  type WorkflowAction,
} from "./catalog.ts";
import { makes, resolveFacts, templateField, unmet } from "./facts.ts";
import { fields } from "./search/fields.ts";
import type { Strategy } from "./search/words.ts";
import {
  assignedValuesText,
  DISCOVER_NEEDS_ONE,
  foundPlugins,
  isReady,
  noPluginFound,
  projectValuesText,
  readinessText,
  routeAdvice,
  routeDone,
  routeFollowed,
  routeInputRefused,
  routeLeft,
  routeTakesNoAction,
  screenNotExecuted,
  unknownAction,
  unknownPlugin,
  unknownRuns,
  unmetRequirement,
  wrongCall,
  wrongFields,
  writesText,
  type Readiness,
} from "./text.ts";

/** Each run a workflow action started, and each part of it that did not start, with why. */
export type Started = {
  runs: { runId: string; concept?: string }[];
  notStarted: { concept: string; reason: string }[];
};

/** A run the coordinator started in the project, as the host lists it. */
export type Run = {
  runId: string;
  plugin: string;
  action: string;
  status: "deployed" | "running" | "completed" | "failed" | "cancelled";
};

/** What the coordinator's tools need from the project they act on, which only the host can do. */
export type Project = {
  // What is true of the project, from what the host stores, and whether the person decides
  // approvals rather than leaving them to Builder.
  state(): Promise<{ facts: ReadonlySet<Fact>; asksApprovals: boolean }>;
  // The handles of the routes the project follows.
  routes(): Promise<readonly string[]>;
  setRoutes(handles: readonly string[]): Promise<unknown>;
  // Each named project value as stored, null where the project has none yet.
  values(names: readonly string[]): Promise<Readonly<Record<string, unknown>>>;
  // Starts a workflow action on its checked input, its run's assignment ending with values, the
  // block of project values it reads and writes.
  start(
    action: WorkflowAction,
    input: unknown,
    values: string,
  ): Promise<Started>;
  // The runs the coordinator started in the project that are at work or ended lately.
  runs(): Promise<readonly Run[]>;
  // Stops a run the coordinator started that is still at work.
  stop(runId: string): Promise<unknown>;
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
export const Runs = type({
  "+": "reject",
  operation: "'list' | 'wait' | 'stop'",
  "runIds?": type("string > 0").array().atLeastLength(1),
  "seconds?": "1 <= number.integer <= 120",
});
const RouteInput = type({ "+": "reject", "leave?": "true" });

const WAIT_SECONDS = 60;
const WAIT_POLL_MS = 2_000;

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

/** discover's arguments, or why they are wrong, with what discover takes among these plugins. */
export function checkedDiscover(plugins: readonly Plugin[], raw: unknown) {
  const takes: Record<string, Field> = {
    query: { about: "What the person asked for, in their words." },
    group: {
      about: "A group, to list every plugin in it.",
      choices: Object.fromEntries(
        [...groupsOf(plugins)].map(([group, members]) => [
          group,
          members.map(({ builder }) => builder.handle).join(", "),
        ]),
      ),
    },
  };
  const outcome = "nothing was found";
  const input = Discover(raw);
  if (input instanceof type.errors)
    return {
      error: wrongCall("discover", outcome, wrongFields(input), takes),
    };
  if ((input.query === undefined) === (input.group === undefined))
    return {
      error: wrongCall(
        "discover",
        outcome,
        [{ field: "query", problem: DISCOVER_NEEDS_ONE }],
        takes,
      ),
    };
  return { input };
}

// What is true of the project, and the routes it follows. A route whose outcome holds is left, so
// nothing from it applies after.
async function projectState(catalog: Catalog, project: Project) {
  const { facts, asksApprovals } = await project.state();
  const handles = await project.routes();
  const routes = catalog.plugins
    .filter(isRoute)
    .filter(
      ({ builder }) =>
        handles.includes(builder.handle) && !facts.has(builder.outcome),
    );
  if (routes.length !== handles.length)
    await project.setRoutes(routes.map(({ builder }) => builder.handle));
  return { facts, asksApprovals, routes };
}
type ProjectState = Awaited<ReturnType<typeof projectState>>;

// The actions whose finished work makes a fact true.
const makersOf = (catalog: Catalog, fact: Fact) =>
  catalog.actions.filter((action) =>
    (action.builder.returns ?? []).some((made) => makes(made, fact)),
  );

const makersIn = (catalog: Catalog) => (fact: Fact) =>
  makersOf(catalog, fact).map(({ name }) => name);

// The person's go-ahead: a fact that only their answer on a screen makes true, such as an approval
// or the design they chose.
const isGoAhead = (catalog: Catalog, fact: Fact) => {
  const makers = makersOf(catalog, fact);
  return makers.length > 0 && makers.every(isScreenAction);
};

// Where an action stands: what it lacks of its own requirements, for the input when there is one,
// and what each route the project follows asks of it as a step.
function readiness(
  catalog: Catalog,
  action: WorkflowAction,
  { facts, asksApprovals, routes }: ProjectState,
  input?: unknown,
): Readiness {
  const requires = (action.builder.requires ?? []).map((alternative) =>
    input === undefined
      ? alternative.filter((fact) => templateField(fact) === undefined)
      : resolveFacts(alternative, input),
  );
  return {
    own: unmet(requires, facts),
    routes: routes.flatMap(({ builder }) => {
      const step = builder.steps.find(
        (named) =>
          named.plugin === action.plugin && named.action === action.action,
      );
      const missing = (step?.requires ?? []).filter((fact) => !facts.has(fact));
      if (missing.length === 0) return [];
      const goAhead = asksApprovals
        ? missing.filter((fact) => isGoAhead(catalog, fact))
        : [];
      return [
        {
          route: builder.handle,
          goAhead,
          advice: missing.filter((fact) => !goAhead.includes(fact)),
        },
      ];
    }),
  };
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

// Each step of a route as if the project followed it, besides the routes it already follows.
const stepsOf = (catalog: Catalog, route: RoutePlugin, state: ProjectState) =>
  route.builder.steps.map(({ plugin, action: name }) => {
    const action = installedAction(catalog, plugin, name);
    if (!action || !isWorkflowAction(action))
      throw new Error(`${route.builder.handle} names ${plugin} ${name}`);
    const routes = state.routes.includes(route)
      ? state.routes
      : [...state.routes, route];
    const { facts, asksApprovals } = state;
    return {
      name: action.name,
      readiness: readinessText(
        readiness(catalog, action, { facts, asksApprovals, routes }),
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
      state.routes.includes(plugin)
        ? "This project is following it."
        : "Start it with execute; the project then follows it, besides any route it follows already.",
      "Steps:",
      ...stepsOf(catalog, plugin, state).map(
        ({ name, readiness: line }) => `  ${name}: ${line}`,
      ),
    ];
  if (!isSpecialist(plugin)) return [];
  return [
    "",
    "Now:",
    ...plugin.actions.map(
      (action) =>
        `  ${action.name}: ${isScreenAction(action) ? "can open now" : readinessText(readiness(catalog, action, state), catalog.factText)}`,
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
  const following = state.routes.includes(route);
  const others = state.routes
    .filter((other) => other !== route)
    .map(({ builder }) => builder.handle);
  if (input.leave) {
    if (following) await project.setRoutes(others);
    return { content: routeLeft(handle, following) };
  }
  if (state.facts.has(outcome))
    return { content: routeDone(handle, outcome, catalog.factText) };
  if (!following) await project.setRoutes([...others, handle]);
  return {
    content: routeFollowed(
      handle,
      others,
      route.guidance,
      stepsOf(catalog, route, state),
    ),
  };
}

// What execute takes, with every plugin it can start.
const executeFields = (catalog: Catalog): Record<string, Field> => ({
  plugin: {
    about: "The handle of the plugin to start.",
    choices: Object.fromEntries(
      catalog.plugins.map(({ builder, description }) => [
        builder.handle,
        description,
      ]),
    ),
  },
  action: {
    about:
      "The name of the specialist's action to start, as discover lists it; a route takes none.",
  },
  input: {
    about:
      "The input that action's guidance describes; for a route, none to follow it or { leave: true } to leave it.",
  },
});

/** What execute answers for a workflow action it started. */
type Result = {
  started: true;
  plugin: string;
  action: string;
  runs: Started["runs"];
  notStarted?: Started["notStarted"];
  // The screen actions that can show the finished work, as plugin and action.
  presents?: string[];
  // What a route the project follows suggests doing first, and why.
  advice?: string;
};

/**
 * Starts a specialist's workflow action, or follows or leaves a route, once its input, what it
 * cannot work without and the person's go-ahead hold.
 */
export async function execute(
  catalog: Catalog,
  project: Project,
  raw: unknown,
): Promise<Outcome> {
  const asked = Execute(raw);
  if (asked instanceof type.errors)
    return {
      content: wrongCall(
        "execute",
        "nothing was started",
        wrongFields(asked),
        executeFields(catalog),
      ),
      isError: true,
    };
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
  const state = await projectState(catalog, project);
  const checked = action.check(asked.input ?? {});
  if (!checked.ok) return { content: checked.text, isError: true };
  const ready = readiness(catalog, action, state, checked.input);
  if (!isReady(ready))
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
  const { reads = [], writes = [], presents } = action.builder;
  let values =
    reads.length === 0
      ? ""
      : assignedValuesText(catalog.values, await project.values(reads));
  if (writes.length > 0) values += writesText(catalog.values, writes);
  const started = await project.start(action, checked.input, values);
  const result: Result = {
    started: true,
    plugin: action.plugin,
    action: action.action,
    runs: started.runs,
  };
  if (started.notStarted.length > 0) result.notStarted = started.notStarted;
  if (presents)
    result.presents = presents.map((name) => `${action.plugin} ${name}`);
  const advice = routeAdvice(ready.routes, makersIn(catalog), catalog.factText);
  if (advice !== "") result.advice = advice;
  return { content: JSON.stringify(result) };
}

const runsFields: Record<string, Field> = {
  operation: {
    about: "What to do.",
    choices: {
      list: "List the runs you started that are at work or ended lately.",
      wait: "Wait for the first of runIds to end, up to seconds.",
      stop: "Stop each of runIds.",
    },
  },
  runIds: {
    about: "The runs to wait for or stop, as execute and list name them.",
  },
  seconds: {
    about: `How long wait waits at most: 1 to 120, ${WAIT_SECONDS} unless given.`,
  },
};

const ended = (run: Run) =>
  run.status !== "deployed" && run.status !== "running";

/** The coordinator's runs: listed, waited on for the first to end, or stopped. */
export async function manageRuns(
  project: Project,
  raw: unknown,
  signal: AbortSignal,
): Promise<Outcome> {
  const asked = Runs(raw);
  const wrong = asked instanceof type.errors ? wrongFields(asked) : [];
  if (
    !(asked instanceof type.errors) &&
    asked.operation !== "list" &&
    asked.runIds === undefined
  )
    wrong.push({
      field: "runIds",
      problem: `${asked.operation} needs the runs to ${asked.operation === "wait" ? "wait for" : "stop"}`,
    });
  if (asked instanceof type.errors || wrong.length > 0)
    return {
      content: wrongCall("runs", "nothing was done", wrong, runsFields),
      isError: true,
    };
  const runs = await project.runs();
  if (asked.operation === "list") return { content: JSON.stringify({ runs }) };
  const named = asked.runIds ?? [];
  const unknown = named.filter(
    (runId) => !runs.some((run) => run.runId === runId),
  );
  if (unknown.length > 0)
    return {
      content: unknownRuns(asked.operation, unknown, runs),
      isError: true,
    };
  if (asked.operation === "stop") {
    const live = runs.filter((run) => named.includes(run.runId) && !ended(run));
    for (const run of live) await project.stop(run.runId);
    return {
      content: JSON.stringify({
        stopped: live.map(({ runId }) => runId),
        alreadyEnded: runs
          .filter((run) => named.includes(run.runId) && ended(run))
          .map(({ runId, status }) => ({ runId, status })),
      }),
    };
  }
  const deadline = Date.now() + (asked.seconds ?? WAIT_SECONDS) * 1000;
  let watched = runs.filter((run) => named.includes(run.runId));
  while (!watched.some(ended) && Date.now() < deadline) {
    await sleep(WAIT_POLL_MS, undefined, { signal });
    watched = (await project.runs()).filter((run) => named.includes(run.runId));
  }
  return {
    content: JSON.stringify({
      ended: watched.filter(ended),
      working: watched.filter((run) => !ended(run)).map(({ runId }) => runId),
      note: "A finished run's report reaches you as a message after this turn.",
    }),
  };
}

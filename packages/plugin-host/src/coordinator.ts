import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { type } from "arktype";
import {
  wrongFields,
  Approval,
  type Fact,
  type Field,
} from "@corbits-builder/plugin";
import {
  isCheckAction,
  isReadyPlan,
  isScreenAction,
  isSpecialist,
  isWorkflowAction,
  type Action,
  type Catalog,
  type CheckAction,
  type Plugin,
  type ReadyPlanPlugin,
  type ScreenAction,
  type WorkflowAction,
} from "./catalog.ts";
import {
  approvalFacts,
  holds,
  makes,
  resolveFacts,
  templateField,
  unmet,
} from "./facts.ts";
import { fields } from "./search/fields.ts";
import type { Strategy } from "./search/words.ts";
import {
  assignedValuesText,
  choiceText,
  DISCOVER_ACTION_NEEDS_PLUGIN,
  DISCOVER_MORE,
  DISCOVER_OWN_PLAN,
  DISCOVER_NEEDS_ONE,
  foundPlugins,
  checkStandingText,
  isReady,
  noActionFound,
  noPluginFound,
  projectValuesText,
  readinessText,
  readyPlanListing,
  readyPlanDone,
  readyPlanFollowed,
  readyPlanIsAdded,
  planLine,
  optionalLeft,
  PLAN_STEP_REMINDER,
  stepAwaitsGoAhead,
  stepDeclined,
  specialistListing,
  stepAdvice,
  unknownAction,
  unknownPlugin,
  unknownRuns,
  unmetRequirement,
  wrongCall,
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

/** A refusal the coordinator reads as it stands, such as a starter's reason for starting nothing. */
export class Refusal extends Error {}

/** A run at work in the project, of any role, with the concept it works on when it has one. */
export type Working = {
  runId: string;
  role: string;
  state: "working" | "waiting" | "approval";
  concept?: string;
};

/** One version of a document filed in the project. */
export type FiledVersion = {
  artifactId: string;
  version: number;
  sha256: string;
};

/** The project as it stands when a run's assignment is written. */
export type Filed = {
  // The current version of each filed document, by kind.
  versions: ReadonlyMap<string, FiledVersion>;
  // The version of the filed document of a kind the person approved, or undefined for none.
  approved(kind: string): number | undefined;
  // A filed document at a version, as an assignment carries it: a design is its DESIGN.md and the
  // names of its screens.
  read(
    version: FiledVersion,
  ): Promise<{ kind: string; title: string; content: string }>;
  // A filed design at a version: its title, its DESIGN.md tokens and its stylesheet when it has one.
  design(
    version: FiledVersion,
  ): Promise<{ title: string; tokens: string; styles?: string }>;
  // The opening that names each filed document of these kinds and, with design, the chosen design,
  // where each sits read-only in the run's workspace; undefined when none of them is filed.
  startHere(kinds: readonly string[], design: boolean): string | undefined;
};

/**
 * One of several looks at the same work that the person compares before choosing one: its label
 * and the direction its run takes.
 */
export type Concept = { label: string; direction: string };

/** The latest record of a check in the project, as the host keeps it. */
export type CheckStanding = {
  plugin: string;
  action: string;
  result: "pass" | "fail" | "skipped";
  summary: string;
  createdAt: string;
  // Whether what it looked at is still what the project has saved.
  current: boolean;
};

/** What running a check answers: its result, or, for one that keeps trying, the id it reports by. */
export type CheckRan =
  | {
      ran: true;
      checkId: string;
      plugin: string;
      action: string;
      result: "pass" | "fail";
      summary: string;
      evidence: readonly string[];
    }
  | { started: true; plugin: string; action: string; checkId: string };

/**
 * An action step of the project's plan as the host shows it: a plugin action with its input, and
 * where it stands.
 */
type SavedPlanChild = {
  id: string;
  title: string;
  plugin: string;
  action: string;
  input: Record<string, unknown>;
  askFirst: boolean;
  goAhead?: { by: string; at: string };
  optional?: boolean;
  approval?: Approval;
  requires?: Fact[];
  declined?: { by: string; at: string };
  state: string;
};
/**
 * A step of the plan: an action step, or a group that only holds action steps, with the handle of
 * the ready-made plan it was added as when it was.
 */
export type SavedPlanStep =
  | SavedPlanChild
  | {
      id: string;
      title: string;
      plan?: string;
      steps: readonly SavedPlanChild[];
    };
/** A step of the plan as saved: one with no id is new, and the host gives it one. */
type PlanChildWrite = Omit<SavedPlanChild, "id" | "declined" | "state"> & {
  id?: string;
};
type PlanGroupWrite = {
  id?: string;
  title: string;
  plan?: string;
  steps: PlanChildWrite[];
};
export type PlanStepWrite = PlanChildWrite | PlanGroupWrite;

// The plan's action steps, those its groups hold among them.
const actionSteps = (steps: readonly SavedPlanStep[]) =>
  steps.flatMap((step) => ("steps" in step ? step.steps : [step]));

/**
 * What a start keeps for a run before its assignment: a record of the run, of the shape the action's
 * definition declares, stored against the run for whatever reads it back by the run; and project
 * values the action writes, saved as the run's own report_values would save them.
 */
export type Kept = {
  record?: unknown;
  values?: Readonly<Record<string, unknown>>;
};

/** What the coordinator's tools need from the project they act on, which only the host can do. */
export type Project = {
  // What is true of the project, from what the host stores; the go-ahead facts that the person's own
  // answers made true, not counting approvals left to Builder; whether the person decides approvals
  // rather than leaving them to Builder, the latest record of each check, and how the person chose
  // to work: each preference's choice by its id.
  state(): Promise<{
    facts: ReadonlySet<Fact>;
    personFacts: ReadonlySet<Fact>;
    asksApprovals: boolean;
    checks: readonly CheckStanding[];
    preferences: Readonly<Record<string, string>>;
  }>;
  // Runs a check on its checked input against the project as saved.
  check(action: CheckAction, input: unknown): Promise<CheckRan>;
  // The handles of the ready-made plans the project is following.
  following(): Promise<readonly string[]>;
  setFollowing(handles: readonly string[]): Promise<unknown>;
  // Each named project value as stored, null where the project has none yet.
  values(names: readonly string[]): Promise<Readonly<Record<string, unknown>>>;
  // Starts a workflow action on its checked input, its run's assignment ending with values, the
  // block of project values it reads and writes; each run is recorded as doing the plan step step.
  start(
    action: WorkflowAction,
    input: unknown,
    values: string,
    step: string | undefined,
  ): Promise<Started>;
  // The runs the coordinator started in the project that are at work or ended lately.
  runs(): Promise<readonly Run[]>;
  // Stops a run the coordinator started that is still at work.
  stop(runId: string): Promise<unknown>;
  // The project's plan as the host shows it, with what it says of each step besides what was saved.
  plan(): Promise<{ steps: readonly SavedPlanStep[] }>;
  // Replaces the plan; a step saved with its id keeps the person's marks on it.
  savePlan(steps: readonly PlanStepWrite[]): Promise<unknown>;
  // The runs at work in the project, whoever started them.
  working(): Promise<readonly Working[]>;
  // Deploys the installed workflow, one run of its role at a time: busy refuses while another is
  // starting, or is still at work once a replied one had time to end. assignment writes the run's
  // first message from the project as it then stands; the host adds the values block and the
  // person's preferences. keep, when given, is kept for the run as deploy keeps it.
  startAlone(run: {
    workflow: string;
    correlation: string;
    assignment(filed: Filed): string | Promise<string>;
    busy(live?: Working): Error;
    keep?: ((filed: Filed) => Kept | Promise<Kept>) | undefined;
  }): Promise<{ runId: string }>;
  // Deploys the installed workflow, as many runs at a time as are started; assignment writes the
  // run's first message from the project as it then stands, and the host adds the values block and
  // the person's preferences. keep, when given, says what the host keeps for the run before the run
  // gets its assignment, from the same project as the assignment saw it.
  deploy(run: {
    workflow: string;
    correlation: string;
    assignment(filed: Filed): string | Promise<string>;
    keep?: (filed: Filed) => Kept | Promise<Kept>;
  }): Promise<{ runId: string }>;
  // Deploys the installed workflow once for each concept, each concept one run's at a time and
  // recorded as that run's, within the host's ceiling on concepts at work. A concept's run starts
  // once its replied one had time to end; busy refuses it while another is starting, or while live
  // still works on it. Each concept reports its run, or why it did not start.
  startConcepts(run: {
    workflow: string;
    correlation: string;
    concepts: readonly Concept[];
    assignment(filed: Filed, concept: Concept): string;
    busy(concept: string, live?: Working): Error;
  }): Promise<
    readonly (
      | { concept: string; runId: string }
      | { concept: string; error: string }
    )[]
  >;
};

// The one place the search is chosen.
const search: Strategy = fields;

const MAX_FOUND = 5;

/**
 * A field of a coordinator tool as its published schema describes it and a refusal repeats it, with
 * the fields of what it holds when it holds objects. Choices known only from the project's catalog
 * are added to the refusal alone.
 */
export type Described = Field & {
  fields?: Readonly<Record<string, Described>>;
};

const describedText = ({ about, choices = {}, otherwise }: Field) =>
  [
    about,
    ...Object.entries(choices).map(([name, text]) => `${name}: ${text}`),
    ...(otherwise === undefined ? [] : [otherwise]),
  ].join(" ");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// Sets each property's description from its field, at every depth the schema nests objects.
function describe(node: unknown, fields: Readonly<Record<string, Described>>) {
  if (Array.isArray(node)) {
    for (const each of node) describe(each, fields);
    return;
  }
  if (!isRecord(node)) return;
  describe(node["items"], fields);
  describe(node["anyOf"], fields);
  const { properties } = node;
  if (!isRecord(properties)) return;
  for (const [name, property] of Object.entries(properties)) {
    const field = fields[name];
    if (!isRecord(property) || field === undefined) continue;
    property["description"] = describedText(field);
    describe(property, field.fields ?? {});
  }
}

/** A tool's input schema as the model reads it, each property described by its field. */
export function describedSchema(
  schema: { toJsonSchema(): object },
  fields: Readonly<Record<string, Described>>,
): Record<string, unknown> {
  const json = { ...schema.toJsonSchema() };
  describe(json, fields);
  return json;
}

// One object rather than a union: providers want a tool's input schema to be a plain object.
export const Discover = type({
  "+": "reject",
  "query?": "string > 0",
  "group?": "string > 0",
  // One plugin's full guidance, or with action that one action's.
  "plugin?": "string > 0",
  "action?": "string > 0",
});
export const Execute = type({
  "+": "reject",
  plugin: "string > 0",
  "action?": "string > 0",
  "input?": "Record<string, unknown>",
  "step?": "string > 0",
});
export const Runs = type({
  "+": "reject",
  operation: "'list' | 'wait' | 'stop'",
  "runIds?": type("string > 0").array().atLeastLength(1),
  "seconds?": "1 <= number.integer <= 120",
});

const WAIT_SECONDS = 60;

const DISCOVER_FIELDS = {
  query: {
    about:
      "What the person asked for, in their words. Set it to find the plugins that fit a request; leave it out when you pass group or plugin.",
  },
  plugin: {
    about:
      "A plugin's handle, as discover lists it, for its full guidance and the input each of its actions takes. Set it before you first start or open one of its actions; leave it out when you pass query or group.",
  },
  action: {
    about:
      "One of that plugin's actions, as discover lists them, for that action's guidance alone. Set it only together with plugin; leave it out for all of the plugin's guidance.",
  },
  group: {
    about:
      "A group's name, as discover lists the groups, to list every plugin in it. Set it to see every plugin for one kind of work; leave it out when you pass query or plugin.",
  },
} satisfies Record<keyof typeof Discover.infer, Described>;

const EXECUTE_FIELDS = {
  plugin: {
    about:
      "The handle of the specialist whose action to start or screen to open, one of the plugins discover lists. A ready-made plan is not one: add it with the plan tool.",
  },
  action: {
    about:
      "The name of the action to start or screen to open, one of that plugin's actions as discover lists them. Always set it: without it nothing starts.",
  },
  input: {
    about:
      "The input that action's guidance from discover describes. Leave it out only for an action that takes no input.",
  },
  step: {
    about:
      "The id of the plan step this start does, as the plan tool names it; the step must be for this same action. Set it whenever the work is a step of the plan, so the plan shows this run on it. Leave it out for work that is not on the plan.",
  },
} satisfies Record<keyof typeof Execute.infer, Described>;

const RUNS_FIELDS = {
  operation: {
    about: "What to do.",
    choices: {
      list: "List the runs you started that are at work or ended lately.",
      wait: "Wait for the first of runIds to end, up to seconds.",
      stop: "Stop each of runIds.",
    },
  },
  runIds: {
    about:
      "The runs to wait for or stop, as execute and list name them. Set it for wait and stop; leave it out for list.",
  },
  seconds: {
    about: `For wait: how long to wait at most, 1 to 120. Leave it out to wait ${WAIT_SECONDS} seconds.`,
  },
} satisfies Record<keyof typeof Runs.infer, Described>;

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

// The plugins a query, a group or a plugin's handle picks out.
function foundBy(plugins: readonly Plugin[], asked: typeof Discover.infer) {
  const { query, group, plugin } = asked;
  if (query !== undefined)
    return search(query, plugins)
      .slice(0, MAX_FOUND)
      .flatMap(({ handle }) =>
        plugins.filter((each) => each.builder.handle === handle),
      );
  if (group !== undefined) return groupsOf(plugins).get(group) ?? [];
  return plugins.filter((each) => each.builder.handle === plugin);
}

// The full guidance discover's plugin, and action when given, name, with status's word on the
// plugin and now's on the action; why nothing was found when either is not there.
function guidanceOf(
  plugins: readonly Plugin[],
  asked: typeof Discover.infer,
  status: (plugin: Plugin) => string[],
  now: (action: Action) => string[],
) {
  const [plugin] = foundBy(plugins, asked);
  if (!plugin) return noPluginFound(asked, groupsOf(plugins));
  if (asked.action === undefined) return foundPlugins([plugin], status);
  const actions = isSpecialist(plugin) ? plugin.actions : [];
  const action = actions.find((each) => each.action === asked.action);
  if (!action)
    return noActionFound(
      plugin.builder.handle,
      asked.action,
      actions.map((each) => each.action),
    );
  return [action.guidance, ...now(action)].join("\n");
}

/** discover's arguments, or why they are wrong, with what discover takes among these plugins. */
export function checkedDiscover(plugins: readonly Plugin[], raw: unknown) {
  const takes: Record<string, Field> = {
    query: DISCOVER_FIELDS.query,
    plugin: DISCOVER_FIELDS.plugin,
    action: DISCOVER_FIELDS.action,
    group: {
      about: DISCOVER_FIELDS.group.about,
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
  const asked = [input.query, input.group, input.plugin].filter(
    (named) => named !== undefined,
  );
  if (asked.length !== 1)
    return {
      error: wrongCall(
        "discover",
        outcome,
        [{ field: "query", problem: DISCOVER_NEEDS_ONE }],
        takes,
      ),
    };
  if (input.action !== undefined && input.plugin === undefined)
    return {
      error: wrongCall(
        "discover",
        outcome,
        [{ field: "action", problem: DISCOVER_ACTION_NEEDS_PLUGIN }],
        takes,
      ),
    };
  return { input };
}

// What is true of the project, its plan, and the ready-made plans it is following. A plan whose
// ending fact holds is left, so it is no longer listed as followed.
async function projectState(catalog: Catalog, project: Project) {
  const { facts, personFacts, asksApprovals, checks } = await project.state();
  const handles = await project.following();
  const following = catalog.plugins
    .filter(isReadyPlan)
    .filter(
      ({ builder }) =>
        handles.includes(builder.handle) &&
        (builder.ends === undefined || !facts.has(builder.ends)),
    );
  if (following.length !== handles.length)
    await project.setFollowing(following.map(({ builder }) => builder.handle));
  const plan = await project.plan();
  return { facts, personFacts, asksApprovals, checks, following, plan };
}
type ProjectState = Awaited<ReturnType<typeof projectState>>;

// The actions whose finished work makes a fact true.
const makersOf = (catalog: Catalog, fact: Fact) =>
  catalog.actions.filter((action) =>
    (action.builder.returns ?? []).some((made) => makes(made, fact)),
  );

/** The names of the actions whose finished work makes a fact true. */
export const makersIn = (catalog: Catalog) => (fact: Fact) =>
  makersOf(catalog, fact).map(({ name }) => name);

/** What gates a plan step: the approval it waits for and the facts it suggests having first. */
type Gate = { requires?: readonly Fact[]; approval?: Approval };

/**
 * What a plan step's gate asks that the project lacks. Its approval holds the step back: one
 * required always, on the person's own go-ahead, so approvals left to Builder do not count for it;
 * one optional only while the person decides approvals. What else the step requires is advice.
 */
export function gateOf(
  { requires = [], approval }: Gate,
  {
    facts,
    personFacts,
    asksApprovals,
  }: Pick<ProjectState, "facts" | "personFacts" | "asksApprovals">,
) {
  const when = approval?.when;
  const unapproved = approvalFacts(approval).filter(
    (fact) => !holds(fact, when === "required" ? personFacts : facts),
  );
  const waits = when === "required" || (when === "optional" && asksApprovals);
  const goAhead = waits ? unapproved : [];
  const advice = [
    ...requires.filter((fact) => !holds(fact, facts)),
    ...unapproved.filter((fact) => !goAhead.includes(fact)),
  ];
  return { goAhead, advice };
}

// Where an action stands: what it lacks of its own requirements, for the input when there is one,
// and what the gate of each plan step it would do asks of it.
function readiness(
  catalog: Catalog,
  action: Action,
  state: Pick<ProjectState, "facts" | "personFacts" | "asksApprovals">,
  steps: readonly ({ title: string } & Gate)[],
  input?: unknown,
): Readiness {
  const requires = (action.builder.requires ?? []).map((alternative) =>
    input === undefined ? alternative : resolveFacts(alternative, input),
  );
  return {
    own: unmet(requires, state.facts),
    steps: steps.flatMap((step) => {
      const { goAhead, advice } = gateOf(step, state);
      if (goAhead.length === 0 && advice.length === 0) return [];
      return [{ step: step.title, goAhead, advice }];
    }),
  };
}

// The plan's action steps for this action whose gate still holds: a done step's gate is spent.
const gatingSteps = (action: Action, steps: readonly SavedPlanStep[]) =>
  actionSteps(steps).filter(
    (step) =>
      step.plugin === action.plugin &&
      step.action === action.action &&
      step.state !== "done",
  );

// The installed action that a plugin's handle and an action's name pick out.
const installedAction = (
  catalog: Catalog,
  plugin: string,
  name: string | undefined,
) =>
  catalog.actions.find(
    (action) => action.plugin === plugin && action.action === name,
  );

// Each step of a ready-made plan with where it would stand on the project's plan, gated as adding
// the plan saves it.
const stepsOf = (
  catalog: Catalog,
  readyPlan: ReadyPlanPlugin,
  state: ProjectState,
) =>
  readyPlanStep(readyPlan).steps.map((step) => {
    const action = installedAction(catalog, step.plugin, step.action);
    if (!action)
      throw new Error(
        `${readyPlan.builder.handle} names ${step.plugin} ${step.action}`,
      );
    return {
      name: step.optional
        ? `${action.name} (optional, the person may decline it)`
        : action.name,
      readiness: readinessText(
        readiness(catalog, action, state, [step]),
        catalog.factText,
      ),
    };
  });

// Whether an action could start, or a screen open, in the project now; for a check that can run,
// its latest result.
function now(catalog: Catalog, action: Action, state: ProjectState) {
  const ready = readiness(
    catalog,
    action,
    state,
    gatingSteps(action, state.plan.steps),
  );
  if (isCheckAction(action) && isReady(ready))
    return checkStandingText(
      state.checks.find(
        (check) =>
          check.plugin === action.plugin && check.action === action.action,
      ),
      Date.now(),
    );
  return readinessText(
    ready,
    catalog.factText,
    isScreenAction(action) ? "can open now" : "can start now",
  );
}

// What discover adds about each plugin for this project.
function status(
  catalog: Catalog,
  plugin: Plugin,
  state: ProjectState,
): string[] {
  if (isReadyPlan(plugin))
    return [
      state.following.includes(plugin)
        ? "This project is following it."
        : `Take it up with plan({ operation: "add", plan: "${plugin.builder.handle}" }): its steps go on the project's plan as a group, and the project follows it besides any ready-made plan it is following already.`,
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
      (action) => `  ${action.name}: ${now(catalog, action, state)}`,
    ),
  ];
}

// A plugin as discover lists it: a line for it, and a line for each action or step with where it
// stands for the project.
function listing(catalog: Catalog, plugin: Plugin, state: ProjectState) {
  const { handle } = plugin.builder;
  if (isSpecialist(plugin))
    return specialistListing(
      handle,
      plugin.description,
      plugin.actions.map((action) => ({
        action: action.action,
        screen: isScreenAction(action),
        when: action.when,
        now: now(catalog, action, state),
      })),
    );
  return readyPlanListing(
    handle,
    plugin.description,
    state.following.includes(plugin),
    stepsOf(catalog, plugin, state),
  );
}

/**
 * discover for a project. A query or a group lists each plugin found in a line or two, with where
 * each action stands, and the project's values; a plugin, or one of its actions, comes in full.
 */
export async function discoverFor(
  catalog: Catalog,
  project: Project,
  asked: typeof Discover.infer,
) {
  const state = await projectState(catalog, project);
  const found = foundBy(catalog.plugins, asked);
  // A line on each handle found that several installed plugins share.
  const choices = catalog.choices
    .filter(({ using }) => found.includes(using))
    .map(choiceText);
  if (asked.plugin !== undefined)
    return [
      guidanceOf(
        catalog.plugins,
        asked,
        (plugin) => status(catalog, plugin, state),
        (action) => [`Now: ${now(catalog, action, state)}.`],
      ),
      ...choices,
    ].join("\n\n");
  if (found.length === 0)
    return noPluginFound(asked, groupsOf(catalog.plugins));
  const values = await project.values([...catalog.values.keys()]);
  return [
    ...found.map((plugin) => listing(catalog, plugin, state)),
    ...choices,
    projectValuesText(catalog.values, values),
    planLine(actionSteps(state.plan.steps)),
    DISCOVER_OWN_PLAN,
    DISCOVER_MORE,
  ].join("\n\n");
}

/** Why a screen cannot be shown for this input in the project as it is, or undefined when it can. */
export async function screenRefusal(
  catalog: Catalog,
  project: Project,
  screen: ScreenAction,
  input: unknown,
) {
  const reads = screen.builder.reads ?? [];
  const values = reads.length > 0 ? await project.values(reads) : {};
  const refused = screen.refusal(
    input,
    Object.fromEntries(
      Object.entries(values).map(([name, value]) => [name, value ?? undefined]),
    ),
  );
  if (refused !== undefined || screen.builder.requires === undefined)
    return refused;
  const { facts, personFacts, asksApprovals } = await project.state();
  const ready = readiness(
    catalog,
    screen,
    { facts, personFacts, asksApprovals },
    [],
    input,
  );
  if (isReady(ready)) return undefined;
  return unmetRequirement(
    screen.name,
    ready,
    makersIn(catalog),
    catalog.factText,
    "shown",
  );
}

/**
 * Why a plan cannot hold this step, or undefined when it can: its plugin and action must be
 * installed and its input must fit, refused in the words execute uses. What the action
 * requires is not asked, since a plan holds steps for later; a screen's input is checked without
 * the project's values, which it reads only when it is shown.
 */
export function planStepRefusal(
  catalog: Catalog,
  step: { plugin: string; action: string; input: unknown },
) {
  const plugin = catalog.installed(step.plugin);
  if (!plugin)
    return unknownPlugin(
      step.plugin,
      catalog.actions.map(({ name }) => name),
    );
  if (isReadyPlan(plugin)) return readyPlanIsAdded(plugin.builder.handle);
  const action = installedAction(catalog, plugin.builder.handle, step.action);
  if (!action)
    return unknownAction(plugin.builder.handle, step.action, plugin.actions);
  if (isScreenAction(action)) return action.refusal(step.input, {});
  // A ready-made plan's step whose input only the work so far can say is held with none, and execute
  // checks the input it starts on.
  if (isWorkflowAction(action) && isEmpty(step.input)) return undefined;
  const checked = action.validate(step.input);
  return checked.ok ? undefined : checked.text;
}

const isEmpty = (input: unknown) =>
  typeof input === "object" &&
  input !== null &&
  Object.keys(input).length === 0;

type PlannedStep = {
  title: string;
  plugin: string;
  action: string;
  input: unknown;
};

/**
 * Why a plan cannot be saved, naming by its number the first step it cannot hold, such as 2.1 for
 * the first step under the second; undefined when it can.
 */
export function planRefusal(
  catalog: Catalog,
  steps: readonly (PlannedStep | { steps: readonly PlannedStep[] })[],
) {
  const numbered = steps.flatMap((step, at) =>
    "steps" in step
      ? step.steps.map((child, under) => ({
          number: `${at + 1}.${under + 1}`,
          step: child,
        }))
      : [{ number: `${at + 1}`, step }],
  );
  for (const { number, step } of numbered) {
    const refused = planStepRefusal(catalog, step);
    if (refused !== undefined)
      return {
        step: number,
        text: `Step ${number}, "${step.title}" (${step.plugin} ${step.action}), cannot be in the plan, so the plan was not saved.\n\n${refused}`,
      };
  }
  return undefined;
}

export type Outcome = { content: string; isError?: true };

// The plan step the person holds back that this start would do, by `held`: the same action, making
// the same facts for its input, as writer write declined for a user manual is not declined for a
// report.
function heldStep(
  action: Action,
  input: unknown,
  plan: { steps: readonly SavedPlanStep[] },
  held: (step: SavedPlanChild) => boolean,
) {
  const returns = action.builder.returns ?? [];
  const making = resolveFacts(returns, input);
  return actionSteps(plan.steps).find(
    (step) =>
      held(step) &&
      step.plugin === action.plugin &&
      step.action === action.action &&
      isDeepStrictEqual(resolveFacts(returns, step.input), making),
  );
}

// What execute takes, with every plugin it can start.
const executeFields = (catalog: Catalog): Record<string, Field> => ({
  plugin: {
    about: EXECUTE_FIELDS.plugin.about,
    choices: Object.fromEntries(
      catalog.plugins
        .filter(isSpecialist)
        .map(({ builder, description }) => [builder.handle, description]),
    ),
  },
  action: EXECUTE_FIELDS.action,
  input: EXECUTE_FIELDS.input,
  step: EXECUTE_FIELDS.step,
});

// The plan step a start does when the call names none: the one action step not done yet with the
// same action on the same checked input, as a check record is keyed; none when none or several do.
function matchingStep(
  action: WorkflowAction | CheckAction,
  input: unknown,
  steps: readonly SavedPlanChild[],
) {
  const matching = steps.filter((step) => {
    if (step.state === "done") return false;
    if (step.plugin !== action.plugin || step.action !== action.action)
      return false;
    const checked = action.validate(step.input);
    return checked.ok && isDeepStrictEqual(checked.input, input);
  });
  return matching.length === 1 ? matching[0]?.id : undefined;
}

/** What execute answers for a workflow action it started. */
type Result = {
  started: true;
  plugin: string;
  action: string;
  runs: Started["runs"];
  notStarted?: Started["notStarted"];
  // The screen actions that can show the finished work, as plugin and action.
  presents?: string[];
  // What the plan step the start does suggests doing first, and why.
  advice?: string;
};

// What an execute call acts on: the screen it opens, or the action it starts with its checked input,
// the project as it stands, the plan step the start does and where the action stands for that step;
// or why nothing starts.
async function executing(
  catalog: Catalog,
  project: Project,
  raw: unknown,
): Promise<
  | { refused: string }
  | { screen: ScreenAction; input: Record<string, unknown> }
  | {
      action: WorkflowAction | CheckAction;
      checked: unknown;
      stepId: string | undefined;
      ready: Readiness;
    }
> {
  const asked = Execute(raw);
  if (asked instanceof type.errors)
    return {
      refused: wrongCall(
        "execute",
        "nothing was started",
        wrongFields(asked),
        executeFields(catalog),
      ),
    };
  const plugin = catalog.installed(asked.plugin);
  if (!plugin)
    return {
      refused: unknownPlugin(
        asked.plugin,
        catalog.actions.map(({ name }) => name),
      ),
    };
  if (isReadyPlan(plugin))
    return { refused: readyPlanIsAdded(plugin.builder.handle) };
  const action = installedAction(catalog, plugin.builder.handle, asked.action);
  if (!action)
    return {
      refused: unknownAction(
        plugin.builder.handle,
        asked.action,
        plugin.actions,
      ),
    };
  if (isScreenAction(action))
    return { screen: action, input: asked.input ?? {} };
  const state = await projectState(catalog, project);
  const checked = action.validate(asked.input ?? {});
  if (!checked.ok) return { refused: checked.text };
  const { plan } = state;
  const declined = heldStep(
    action,
    checked.input,
    plan,
    (step) => step.declined !== undefined,
  );
  if (declined) return { refused: stepDeclined(action.name, declined.title) };
  const asking = heldStep(
    action,
    checked.input,
    plan,
    (step) => step.askFirst && step.goAhead === undefined,
  );
  if (asking) return { refused: stepAwaitsGoAhead(action.name, asking.title) };
  // A step id is a hint for tying the run to the plan, never a reason to hold work back: one that
  // names no step for this action falls back to the step the action and input point at. The step
  // the start does is the one whose gate holds it.
  const planned = actionSteps(plan.steps);
  const sameAction = planned.filter(
    (step) => step.plugin === action.plugin && step.action === action.action,
  );
  const stepId =
    sameAction.find(({ id }) => id === asked.step)?.id ??
    matchingStep(action, checked.input, planned) ??
    (sameAction.length === 1 ? sameAction[0]?.id : undefined);
  const ready = readiness(
    catalog,
    action,
    state,
    gatingSteps(action, plan.steps).filter(({ id }) => id === stepId),
    checked.input,
  );
  return { action, checked: checked.input, stepId, ready };
}

/** A screen an execute call waits on: its answer is the call's result, or the call then runs. */
export type ExecutePause = {
  plugin: string;
  action: string;
  input: Record<string, unknown>;
  resume: "result" | "rerun";
};

// The input a screen takes to make these facts true: each templated fact it returns, such as
// "approved:{kinds}", fills its field with what each fact it makes names, as { kinds: ["build_plan"] }.
const inputMaking = (screen: ScreenAction, facts: readonly Fact[]) =>
  Object.fromEntries(
    (screen.builder.returns ?? []).flatMap((made) => {
      const field = templateField(made);
      if (field === undefined) return [];
      const named = facts
        .filter((fact) => makes(made, fact))
        .map((fact) => fact.slice(fact.indexOf(":") + 1));
      return [[field, named]];
    }),
  );

/**
 * What the person answers before an execute call goes on, or undefined when it runs as it is. A
 * screen opens, and the person's answer is the call's result; refusal text when it cannot be shown
 * for this input. A workflow action held only by its plan step's wait on the person's approval
 * opens the one screen that gives that approval, and starts once they answer it. When several
 * screens could give it, or its input cannot be told, execute refuses as it would.
 */
export async function executePause(
  catalog: Catalog,
  project: Project,
  raw: unknown,
): Promise<ExecutePause | string | undefined> {
  const call = await executing(catalog, project, raw);
  if ("refused" in call) return undefined;
  if ("screen" in call) {
    const { screen, input } = call;
    return (
      (await screenRefusal(catalog, project, screen, input)) ?? {
        plugin: screen.plugin,
        action: screen.action,
        input,
        resume: "result",
      }
    );
  }
  const { action, ready } = call;
  if (!isWorkflowAction(action) || ready.own.length > 0) return undefined;
  const awaited = ready.steps.flatMap(({ goAhead }) => goAhead);
  if (awaited.length === 0) return undefined;
  const approving = catalog.screens.filter((screen) =>
    awaited.every((fact) =>
      (screen.builder.returns ?? []).some((made) => makes(made, fact)),
    ),
  );
  const [screen] = approving;
  if (approving.length !== 1 || !screen) return undefined;
  const input = inputMaking(screen, awaited);
  if ((await screenRefusal(catalog, project, screen, input)) !== undefined)
    return undefined;
  return {
    plugin: screen.plugin,
    action: screen.action,
    input,
    resume: "rerun",
  };
}

/**
 * Starts a specialist's workflow action, or runs a check, once its input, what it cannot work
 * without and the person's go-ahead hold. A screen never reaches here: the call pauses on it before
 * it runs. A ready-made plan is taken up with plan add, never here.
 */
export async function execute(
  catalog: Catalog,
  project: Project,
  raw: unknown,
): Promise<Outcome> {
  const call = await executing(catalog, project, raw);
  if ("refused" in call) return { content: call.refused, isError: true };
  if ("screen" in call)
    throw new Error(
      `${call.screen.name} is a screen, which the call pauses on before it runs`,
    );
  const { action, stepId, ready } = call;
  if (!isReady(ready))
    return {
      content: unmetRequirement(
        action.name,
        ready,
        makersIn(catalog),
        catalog.factText,
        "started",
      ),
      isError: true,
    };
  if (isCheckAction(action))
    return {
      content: JSON.stringify(await project.check(action, call.checked)),
    };
  // The hub refuses a read of no names.
  const { reads = [], writes = [], presents } = action.builder;
  let values =
    reads.length === 0
      ? ""
      : assignedValuesText(catalog.values, await project.values(reads));
  if (writes.length > 0) values += writesText(catalog.values, writes);
  const started = await project.start(action, call.checked, values, stepId);
  const result: Result = {
    started: true,
    plugin: action.plugin,
    action: action.action,
    runs: started.runs,
  };
  if (started.notStarted.length > 0) result.notStarted = started.notStarted;
  if (presents)
    result.presents = presents.map((name) => `${action.plugin} ${name}`);
  const advice = stepAdvice(ready.steps, makersIn(catalog), catalog.factText);
  if (advice !== "") result.advice = advice;
  return { content: JSON.stringify(result) };
}

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
      content: wrongCall("runs", "nothing was done", wrong, RUNS_FIELDS),
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

const PlanChildInput = type({
  "+": "reject",
  title: "string > 0",
  plugin: "string > 0",
  action: "string > 0",
  input: "Record<string, unknown>",
  "askFirst?": "boolean",
  "optional?": "boolean",
  "approval?": Approval,
});
type PlanChildInput = typeof PlanChildInput.infer;
export const Plan = type({
  "+": "reject",
  operation: "'show' | 'set' | 'add' | 'remove'",
  "steps?": PlanChildInput.or({
    "+": "reject",
    title: "string > 0",
    steps: PlanChildInput.array(),
  }).array(),
  "plan?": "string > 0",
  "after?": "string > 0",
  "before?": "string > 0",
  "stepIds?": type("string > 0").array().atLeastLength(1),
});
type PlanCall = typeof Plan.infer;
type Problem = { field: string; problem: string };

// The fields each operation of plan takes besides operation.
const PLAN_TAKES: Record<PlanCall["operation"], readonly string[]> = {
  show: [],
  set: ["steps"],
  add: ["steps", "plan", "after", "before"],
  remove: ["stepIds"],
};

// A step on the plan: an action step, or a group holding action steps.
const STEP_FIELDS: Record<string, Described> = {
  title: {
    about: "What the step does, in a few words the person reads on the plan.",
  },
  plugin: {
    about:
      "For an action step: the handle of the plugin whose action it does, as discover lists it. Leave it out of a group.",
  },
  action: {
    about:
      "For an action step: the action it does, as discover lists that plugin's actions. Leave it out of a group.",
  },
  input: {
    about:
      "For an action step: the input that action's guidance describes. When only earlier work can say what it is, pass {} and give the real input when you start the step with execute. Leave it out of a group.",
  },
  askFirst: {
    about:
      "Set it to true when the person asked to be consulted before this step: it then waits until they give the go on the plan. Leave it out to let the step start once it is ready.",
  },
  optional: {
    about:
      "Set it to true when the person may decline this step because the work is complete without it, such as an extra review; a declined step is not started. Leave it out for a step the work needs.",
  },
  approval: {
    about:
      "Set it to hold the step until the person approves documents or chooses the design. Taking the step out of the plan takes its approval with it. Leave it out when the step needs no approval.",
    fields: {
      of: {
        about:
          'The document kinds to approve, as read_artifact lists them, or "design" for choosing the design.',
      },
      when: {
        about: "When the step waits.",
        choices: {
          required: "Always wait for the person's own approval.",
          optional:
            "Wait only while the person decides approvals rather than leaving them to you.",
        },
      },
    },
  },
};
STEP_FIELDS["steps"] = {
  about:
    "For a group: the action steps it holds, in order. A group holds no groups. Leave it out of an action step.",
  fields: STEP_FIELDS,
};

const PLAN_FIELDS = {
  operation: {
    about: "What to do; each answers with the plan as it now stands.",
    choices: {
      show: "The plan.",
      set: "Replace the plan with steps, a plan of your own; [] empties it. The project then follows no ready-made plan.",
      add: "Add steps, or one ready-made plan, at the end, after the step after names or before the step before names.",
      remove:
        "Take out each step stepIds names, with the steps it holds; taking out a ready-made plan's group stops the project following that plan.",
    },
  },
  steps: {
    about:
      "For set and add: the steps, in order. Each is an action step { title, plugin, action, input, askFirst?, optional?, approval? }, which does one plugin action, or a group { title, steps }, which starts nothing and holds action steps. A step with both steps and an action is refused.",
    fields: STEP_FIELDS,
  },
  plan: {
    about:
      "For add, in place of steps: a ready-made plan, by its handle as discover lists it. It goes on as one group holding its steps, each saying whether the person may decline it, the approval it waits for and what it suggests having first, and the project follows that plan while its group is on the plan. Leave it out when you add steps of your own.",
  },
  after: {
    about:
      "For add: the id of the step the new steps go after. Leave out both after and before to add them at the end.",
  },
  before: {
    about:
      "For add, in place of after: the id of the step the new steps go before.",
  },
  stepIds: { about: "For remove: the ids of the steps to take out." },
} satisfies Record<keyof PlanCall, Described>;

const planFields = (catalog: Catalog): Record<string, Field> => ({
  operation: PLAN_FIELDS.operation,
  steps: PLAN_FIELDS.steps,
  plan: {
    about: PLAN_FIELDS.plan.about,
    choices: Object.fromEntries(
      catalog.plugins
        .filter(isReadyPlan)
        .map(({ builder, description }) => [builder.handle, description]),
    ),
  },
  after: PLAN_FIELDS.after,
  before: PLAN_FIELDS.before,
  stepIds: PLAN_FIELDS.stepIds,
});

/** The input schema of each of the coordinator's tools, as the model reads it. */
export const INPUT_SCHEMAS = {
  discover: describedSchema(Discover, DISCOVER_FIELDS),
  execute: describedSchema(Execute, EXECUTE_FIELDS),
  runs: describedSchema(Runs, RUNS_FIELDS),
  plan: describedSchema(Plan, PLAN_FIELDS),
};

const wrongPlanCall = (
  catalog: Catalog,
  wrong: readonly Problem[],
): Outcome => ({
  content: wrongCall(
    "plan",
    "the plan was not changed",
    wrong,
    planFields(catalog),
  ),
  isError: true,
});

// What is wrong with a call before the plan is read: a field its operation does not take, one it
// needs, or a ready-made plan the catalog does not have.
function planCallProblems(catalog: Catalog, asked: PlanCall) {
  const { operation } = asked;
  const wrong: Problem[] = Object.keys(asked)
    .filter(
      (field) =>
        field !== "operation" && !PLAN_TAKES[operation].includes(field),
    )
    .map((field) => ({ field, problem: `${operation} takes no ${field}` }));
  if (operation === "set" && asked.steps === undefined)
    wrong.push({
      field: "steps",
      problem: "set needs the steps the plan holds",
    });
  if (operation === "remove" && asked.stepIds === undefined)
    wrong.push({
      field: "stepIds",
      problem: "remove needs the steps to take out",
    });
  if (
    operation === "add" &&
    (asked.steps === undefined) === (asked.plan === undefined)
  )
    wrong.push({
      field: "steps",
      problem: "add needs either steps or plan, and not both",
    });
  if (asked.after !== undefined && asked.before !== undefined)
    wrong.push({
      field: "before",
      problem: "add takes either after or before, and not both",
    });
  const named =
    asked.plan === undefined ? undefined : catalog.installed(asked.plan);
  if (asked.plan !== undefined && (!named || !isReadyPlan(named)))
    wrong.push({
      field: "plan",
      problem: `${JSON.stringify(asked.plan)} is not an installed ready-made plan`,
    });
  return wrong;
}

// What is wrong with the step ids a call names, against the plan as saved.
function planIdProblems(
  asked: PlanCall,
  saved: readonly SavedPlanStep[],
  adding: readonly PlanStepWrite[],
) {
  const children = saved.flatMap((step) => ("steps" in step ? step.steps : []));
  const all = [...saved, ...children];
  const ids = all.map(({ id }) => id);
  const listed =
    all.length === 0
      ? "the plan has no steps yet"
      : `the plan's steps: ${all.map(({ id, title }) => `${id} (${title})`).join(", ")}`;
  const wrong: Problem[] = [];
  const unknown = (asked.stepIds ?? []).filter((id) => !ids.includes(id));
  if (unknown.length > 0)
    wrong.push({
      field: "stepIds",
      problem: `${unknown.join(", ")} not in the plan; ${listed}`,
    });
  for (const field of ["after", "before"] as const) {
    const named = asked[field];
    if (named === undefined) continue;
    if (!ids.includes(named))
      wrong.push({ field, problem: `${named} is not in the plan; ${listed}` });
    else if (
      children.some(({ id }) => id === named) &&
      adding.some((step) => "steps" in step)
    )
      wrong.push({
        field,
        problem: `${named} is held by another step, so what goes ${field} it cannot hold steps; name the step that holds it`,
      });
  }
  return wrong;
}

// A saved step as it is saved again, under its id so the person's marks on it stay, and with what
// its ready-made plan or the coordinator said of it.
function childWrite({
  id,
  title,
  plugin,
  action,
  input,
  askFirst,
  optional,
  approval,
  requires,
}: SavedPlanChild): PlanChildWrite {
  const written: PlanChildWrite = {
    id,
    title,
    plugin,
    action,
    input,
    askFirst,
  };
  if (optional) written.optional = optional;
  if (approval) written.approval = approval;
  if (requires) written.requires = requires;
  return written;
}
function stepWrite(step: SavedPlanStep): PlanStepWrite {
  if (!("steps" in step)) return childWrite(step);
  const group: PlanGroupWrite = {
    id: step.id,
    title: step.title,
    steps: step.steps.map(childWrite),
  };
  if (step.plan) group.plan = step.plan;
  return group;
}

// A step the call names, new to the plan.
function childOf({
  title,
  plugin,
  action,
  input,
  askFirst = false,
  optional,
  approval,
}: PlanChildInput): PlanChildWrite {
  const child: PlanChildWrite = { title, plugin, action, input, askFirst };
  if (optional) child.optional = optional;
  if (approval) child.approval = approval;
  return child;
}
function newStep(
  step: PlanChildInput | { title: string; steps: PlanChildInput[] },
): PlanStepWrite {
  if (!("steps" in step)) return childOf(step);
  return { title: step.title, steps: step.steps.map(childOf) };
}

// A ready-made plan as one group holding its steps, each with whether the person may decline it,
// its gate as the plan's step says, marked with the plan's handle so the project follows it.
function readyPlanStep({
  builder,
  description,
}: ReadyPlanPlugin): PlanGroupWrite {
  const children = builder.steps.map((step) => {
    const child = childOf({
      title: step.title ?? `${step.plugin} ${step.action}`,
      plugin: step.plugin,
      action: step.action,
      input: step.input ?? {},
      optional: step.optional ?? false,
    });
    if (step.approval) child.approval = step.approval;
    if (step.requires.length > 0) child.requires = step.requires;
    return child;
  });
  return { title: description, plan: builder.handle, steps: children };
}

// The plan with steps added at its end, or after the step after names or before the step before
// names, at whichever level it is; a group holds no groups, which planIdProblems refuses before this.
function added(
  plan: PlanStepWrite[],
  adding: readonly PlanStepWrite[],
  { after, before }: Pick<PlanCall, "after" | "before">,
) {
  const next = after ?? before;
  if (next === undefined) return [...plan, ...adding];
  const offset = after === undefined ? 0 : 1;
  const at = plan.findIndex(({ id }) => id === next);
  if (at >= 0) return plan.toSpliced(at + offset, 0, ...adding);
  const held = adding.flatMap((each) => ("steps" in each ? [] : [each]));
  for (const step of plan) {
    if (!("steps" in step)) continue;
    const under = step.steps.findIndex(({ id }) => id === next);
    if (under >= 0)
      step.steps = step.steps.toSpliced(under + offset, 0, ...held);
  }
  return plan;
}

// The plan without the steps ids names, nor what they hold.
function removed(plan: PlanStepWrite[], ids: readonly string[]) {
  const kept = ({ id }: PlanStepWrite) => id === undefined || !ids.includes(id);
  for (const step of plan)
    if ("steps" in step) step.steps = step.steps.filter(kept);
  return plan.filter(kept);
}

const SETTLED = new Set(["done", "skipped", "cancelled"]);

// The plan as it stands, and once only optional steps are left unstarted, what is owed on them.
async function planAnswer(
  saved: { steps: readonly SavedPlanStep[] },
  project: Project,
) {
  const answer = `${JSON.stringify(saved)}\n\n${PLAN_STEP_REMINDER}`;
  const steps = actionSteps(saved.steps);
  const left = steps.filter(
    (step) => step.optional && step.state === "not_started",
  );
  if (
    left.length === 0 ||
    steps.some((step) => !step.optional && !SETTLED.has(step.state))
  )
    return answer;
  const { asksApprovals } = await project.state();
  return `${answer}\n\n${optionalLeft(
    left.map(({ title }) => title),
    asksApprovals,
  )}`;
}

/**
 * The project's plan: shown, replaced, added to or taken from. A change is saved whole, each saved
 * step under its id, and answers with the plan as it then stands; a plan the catalog refuses is not
 * saved, and the refusal names the step. The project follows the ready-made plans whose groups the
 * saved plan holds, and no others.
 */
export async function managePlan(
  catalog: Catalog,
  project: Project,
  raw: unknown,
): Promise<Outcome> {
  const asked = Plan(raw);
  if (asked instanceof type.errors)
    return wrongPlanCall(catalog, wrongFields(asked));
  const wrong = planCallProblems(catalog, asked);
  if (wrong.length > 0) return wrongPlanCall(catalog, wrong);
  if (asked.operation === "show")
    return { content: await planAnswer(await project.plan(), project) };
  const named =
    asked.plan === undefined ? undefined : catalog.installed(asked.plan);
  const readyPlan = named && isReadyPlan(named) ? named : undefined;
  const ends = readyPlan?.builder.ends;
  if (
    readyPlan &&
    ends !== undefined &&
    (await project.state()).facts.has(ends)
  )
    return {
      content: readyPlanDone(readyPlan.builder.handle, ends, catalog.factText),
    };
  let steps = (asked.steps ?? []).map(newStep);
  if (asked.operation !== "set") {
    const { steps: saved } = await project.plan();
    const adding = readyPlan ? [readyPlanStep(readyPlan)] : steps;
    const wrongIds = planIdProblems(asked, saved, adding);
    if (wrongIds.length > 0) return wrongPlanCall(catalog, wrongIds);
    const current = saved.map(stepWrite);
    steps =
      asked.operation === "add"
        ? added(current, adding, asked)
        : removed(current, asked.stepIds ?? []);
  }
  const refused = planRefusal(catalog, steps);
  if (refused) return { content: refused.text, isError: true };
  await project.savePlan(steps);
  const saved = await project.plan();
  await project.setFollowing(
    saved.steps.flatMap((step) =>
      "steps" in step && step.plan !== undefined ? [step.plan] : [],
    ),
  );
  const plan = await planAnswer(saved, project);
  if (!readyPlan) return { content: plan };
  // The coordinator reads the guidance of the ready-made plan it added and where each step stands.
  const state = await projectState(catalog, project);
  const others = state.following
    .filter((other) => other !== readyPlan)
    .map(({ builder }) => builder.handle);
  return {
    content: `${plan}\n\n${readyPlanFollowed(
      readyPlan.builder.handle,
      others,
      readyPlan.guidance,
      stepsOf(catalog, readyPlan, state),
    )}`,
  };
}

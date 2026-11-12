import {
  inputText,
  type Fact,
  type Field,
  type ValueDeclaration,
} from "@corbits-builder/plugin";
import type { Plugin, ScreenAction } from "./catalog.ts";

// A fact in plain words, as the catalog has it from the plugins.
type FactText = (fact: Fact) => string;

// What the coordinator reads about execute, the facts an action requires, and why nothing started.

export const EXECUTE_DESCRIPTION =
  "Start a specialist plugin's action by the plugin's handle and the action's name, with the input that action's guidance from discover describes, such as { plugin: \"coder\", action: \"change\", input }. A workflow action starts its specialist and returns at once with { started, plugin, action, runs: [{ runId }], presents, advice }; each run's report arrives later as a message that begins with its run id. Independent pieces of work can start in the same turn, each with its own execute. Nothing starts when the action lacks what it cannot work without, or the person's go-ahead that a route the project follows asks for while they decide approvals; the refusal names what is missing and which plugin action makes it true. Anything else a route suggests doing first comes back as advice with the started run. A route plugin takes no action: it adds that route to those the project follows and returns its guidance; input { leave: true } takes the project off it. A screen action is opened with question({ plugin, action, input }).";

export const RUNS_DESCRIPTION =
  'See and steer the runs you started with execute. operation "list" lists each run you started in this project that is at work or ended lately: its plugin and action, status, state while it runs, when it started, its last activity, and why a failed run stopped. "wait" waits up to seconds (60 unless given, at most 120) for the first of runIds to end and says which ended; a run\'s report still reaches you as a message after your turn. "stop" stops each of runIds; what a stopped run filed or pushed is kept.';

/** Why a tool call was not run, every wrong field at once, then everything the tool takes. */
export function wrongCall(
  tool: string,
  outcome: string,
  wrong: readonly { field: string; problem: string }[],
  fields: Record<string, Field>,
) {
  return [
    `${tool} was not run, so ${outcome}. ${wrong.length === 1 ? "One field is" : `${wrong.length} fields are`} wrong:`,
    ...wrong.map(({ field, problem }) =>
      Object.hasOwn(fields, field)
        ? `  ${field}: ${problem}`
        : `  ${field}: ${tool} takes no ${field}`,
    ),
    "",
    `What ${tool} takes:`,
    inputText(fields),
    "",
    "Call again with every field above corrected.",
  ].join("\n");
}

/** What a run's assignment says about the project values it may save as it learns them. */
export const writesText = (values: Values, writes: readonly string[]) =>
  [
    "\n\nWhen you learn any of these about the project, save it with report_values({ name: value }); it saves only these:",
    ...writes.map(
      (name) =>
        `- ${name} (${values.get(name)?.type}): ${values.get(name)?.about}`,
    ),
  ].join("\n");

export const DISCOVER_DYNAMIC_DESCRIPTION =
  "Find what you can do for the person: every piece of work you can start is a plugin. Pass query with what they asked for, in their words, or group to list every plugin in that group: each comes in a line, with a line for each action saying what it is for and whether it can start or open now, or what it needs first, and then the project's values. Pass plugin, and action, for that action's full guidance and the input it takes; read it before you first start or open an action. Specialist actions and route plugins are started with execute; a screen action is shown to the person with question({ plugin, action, input }).";

/** Missing facts that together make one alternative, with the installed actions that make them true. */
const missingLine = (
  facts: readonly Fact[],
  makers: readonly string[],
  factText: FactText,
) =>
  `  - ${facts.map(factText).join(" and ")}` +
  (makers.length > 0
    ? ` (${[...new Set(makers)].join(" or ")} makes this true)`
    : "");

/** What an action requires, in plain words; each alternative is enough on its own. */
export const requiresText = (
  requires: readonly (readonly Fact[])[],
  factText: FactText,
) =>
  requires.length === 0
    ? "nothing"
    : requires
        .map((alternative) => alternative.map(factText).join(" and "))
        .join("; or ");

/** The guidance line for an action whose run Builder hands project values, or none. */
export const suppliedText = (reads: readonly string[]) =>
  reads.length === 0
    ? []
    : [
        `Builder gives the run the project's ${reads.join(", ")} itself; do not pass them.`,
      ];

type Values = ReadonlyMap<string, ValueDeclaration>;

/** The block a run's assignment carries for the project values its action reads. */
export const assignedValuesText = (
  values: Values,
  read: Readonly<Record<string, unknown>>,
) =>
  [
    "\n\nProject values, as the project has them; follow each that is set:",
    ...Object.entries(read).map(
      ([name, value]) =>
        `- ${name}: ${values.get(name)?.about} ${value === null ? "Not set." : `Value: ${JSON.stringify(value)}`}`,
    ),
  ].join("\n");

// How much of a value discover shows; the actions that read it get all of it.
const SHOWN_VALUE = 200;

const shownValue = (value: unknown) => {
  if (value === null) return "Not set.";
  const json = JSON.stringify(value);
  if (json.length <= SHOWN_VALUE) return `Now: ${json}`;
  return `Now: ${json.slice(0, SHOWN_VALUE)}… (shortened from ${json.length} characters; the actions that read it get all of it)`;
};

/** The project's values as discover lists them, each with what it holds now. */
export const projectValuesText = (
  values: Values,
  read: Readonly<Record<string, unknown>>,
) =>
  [
    "Project values (Builder hands each to the actions and screens that read it; the person sets them on screens, and an action that writes one saves it as its run learns it):",
    ...[...values].map(
      ([name, { about }]) => `  ${name}: ${about} ${shownValue(read[name])}`,
    ),
  ].join("\n");

// What a route the project follows asks of one of its steps that the project lacks: the person's
// go-ahead, which holds the step back while they decide approvals, and the rest, which is advice.
export type RouteStep = { route: string; goAhead: Fact[]; advice: Fact[] };

export type Readiness = {
  // For each of the action's own alternatives, what it still lacks; empty when one holds.
  own: Fact[][];
  // What each route the project follows asks of this step that the project lacks.
  routes: RouteStep[];
};

/** Whether nothing holds an action back: what it needs of its own and the person's go-ahead. */
export const isReady = ({ own, routes }: Readiness) =>
  own.length === 0 && routes.every(({ goAhead }) => goAhead.length === 0);

/** Whether an action could start, or a screen open, now, in a line for discover and a route's steps. */
export function readinessText(
  readiness: Readiness,
  factText: FactText,
  ready = "can start now",
) {
  const facts = (list: readonly Fact[]) => list.map(factText).join(" and ");
  const parts = isReady(readiness) ? [ready] : [];
  if (readiness.own.length > 0)
    parts.push(`needs: ${requiresText(readiness.own, factText)}`);
  for (const { route, goAhead } of readiness.routes)
    if (goAhead.length > 0)
      parts.push(
        `needs the person's go-ahead, which ${route} asks for: ${facts(goAhead)}`,
      );
  for (const { route, advice } of readiness.routes)
    if (advice.length > 0)
      parts.push(`${route} suggests first: ${facts(advice)}`);
  return parts.join("; ");
}

/**
 * Why a workflow action was not started with execute, or a screen not shown with question, naming
 * each missing fact and what makes it true.
 */
export function unmetRequirement(
  handle: string,
  { own, routes }: Readiness,
  makers: (fact: Fact) => string[],
  factText: FactText,
  tool: "execute" | "question",
) {
  const lines = [
    `${handle} was not ${tool === "execute" ? "started" : "shown"}. The project does not have what it needs yet.`,
    "",
  ];
  if (own.length > 0)
    lines.push(
      own.length === 1 ? "It needs:" : "It needs one of these:",
      ...(own.length === 1 ? own[0]!.map((fact) => [fact]) : own).map((facts) =>
        missingLine(facts, facts.flatMap(makers), factText),
      ),
    );
  const holding = routes.filter(({ goAhead }) => goAhead.length > 0);
  for (const { route, goAhead } of holding) {
    if (lines.length > 2) lines.push("");
    lines.push(
      `The person decides approvals, and this project follows ${route}, which asks for their go-ahead first:`,
      ...goAhead.map((fact) => missingLine([fact], makers(fact), factText)),
    );
  }
  lines.push(
    "",
    `Start what makes these true first, or ask the person, then call ${tool} again.`,
  );
  for (const { route } of holding)
    lines.push(
      `If the person directs the work elsewhere, take the project off ${route} with execute({ plugin: "${route}", input: { leave: true } }).`,
    );
  return lines.join("\n");
}

/** What the routes suggest doing before an action that started anyway, and why; empty for nothing. */
export const routeAdvice = (
  routes: readonly RouteStep[],
  makers: (fact: Fact) => string[],
  factText: FactText,
) =>
  routes
    .filter(({ advice }) => advice.length > 0)
    .map(
      ({ route, advice }) =>
        `${route} suggests doing this first: ${advice
          .map((fact) => {
            const making = [...new Set(makers(fact))];
            return making.length > 0
              ? `${factText(fact)} (${making.join(" or ")} makes this true)`
              : factText(fact);
          })
          .join(
            "; ",
          )}. The route orders the work so each step builds on what the one before made; this started without it.`,
    )
    .join("\n");

export const unknownPlugin = (handle: string, startable: readonly string[]) =>
  [
    `${JSON.stringify(handle)} is not an installed plugin, so nothing was started.`,
    "",
    `What execute starts, as plugin and action: ${startable.join(", ")}.`,
    "Call again with plugin and action set to one of them, or use discover to find one for what the person wants.",
  ].join("\n");

export const unknownAction = (
  handle: string,
  asked: string | undefined,
  actions: readonly { action: string; description: string }[],
) =>
  [
    asked === undefined
      ? `${handle} is a specialist and execute needs one of its actions, so nothing was started.`
      : `${handle} has no action ${JSON.stringify(asked)}, so nothing was started.`,
    "",
    "Its actions:",
    ...actions.map(({ action, description }) => `  ${action}: ${description}`),
    "",
    "Call again with action set to one of them.",
  ].join("\n");

/** Why runs did nothing with run ids that are not runs the coordinator started here. */
export const unknownRuns = (
  operation: string,
  unknown: readonly string[],
  yours: readonly { runId: string; plugin: string; action: string }[],
) =>
  [
    `${unknown.join(", ")} ${unknown.length === 1 ? "is not a run" : "are not runs"} you started in this project, so nothing was done with ${operation}.`,
    "",
    yours.length === 0
      ? "You have started no runs here yet; execute starts one."
      : "Your runs:",
    ...yours.map(
      ({ runId, plugin, action }) => `  ${runId}: ${plugin} ${action}`,
    ),
    "",
    "Call again with runIds from that list.",
  ].join("\n");

export const routeTakesNoAction = (handle: string) =>
  `${handle} is a route and takes no action, so nothing was started. Call again with no action to follow it, or name the specialist whose action you meant.`;

const questionCall = (plugin: string, action: string) =>
  `question({ plugin: "${plugin}", action: "${action}", input })`;

/** How a screen action is opened, as its guidance ends. */
export const screenText = (plugin: string, action: string) =>
  `Open it with ${questionCall(plugin, action)}.`;

export const screenNotExecuted = ({ name, plugin, action }: ScreenAction) =>
  `${name} is a screen, so nothing was started. A screen is opened with ${questionCall(plugin, action)}.`;

/** What a finished run's report says about the screens that can show its work to the person. */
export const presentsText = (
  plugin: string,
  screens: readonly { action: string; when: string }[],
) =>
  [
    "To show this to the person, open the screen that fits; Builder fills in the newest version itself:",
    ...screens.map(
      ({ action, when }) =>
        `- question({ plugin: "${plugin}", action: "${action}", input: {} }) when: ${when}`,
    ),
  ].join("\n");

export const routeInputRefused = (handle: string, problem: string) =>
  `${handle} was not changed. Its input takes only leave: true, to take the project off the route; ${problem}. Call again with no input to follow it, or with { leave: true }.`;

export const routeLeft = (handle: string, wasOn: boolean) =>
  wasOn
    ? `The project no longer follows ${handle}, so nothing of it applies to its steps any more.`
    : `The project was not following ${handle}, so nothing changed.`;

export const routeDone = (handle: string, outcome: Fact, factText: FactText) =>
  `${handle} was not followed: what it leads to already holds (${factText(outcome)}). Start the action the person's request needs directly.`;

/** A route's guidance, how it combines with the others the project follows, and where each step stands. */
export const routeFollowed = (
  handle: string,
  others: readonly string[],
  guidance: string,
  steps: readonly { name: string; readiness: string }[],
) =>
  [
    `The project now follows ${handle}. It stays on it until the outcome holds or you leave it.`,
    ...(others.length > 0
      ? [
          `It also follows ${others.join(", ")}. Where routes share a step, the person's go-ahead any of them asks for holds the step while they decide approvals, and each route's other advice comes with the started run.`,
        ]
      : []),
    "",
    guidance,
    "",
    "Where each step stands now:",
    ...steps.map(({ name, readiness }) => `  ${name}: ${readiness}`),
  ].join("\n");

// What the coordinator reads when its question names a screen the hub does not have.
export function unknownScreen(
  asked: { plugin: string; action?: string },
  installed: readonly ScreenAction[],
): string {
  const named =
    asked.action === undefined
      ? `${asked.plugin}, with no action,`
      : `${asked.plugin} ${asked.action}`;
  return [
    `${named} is not an installed screen, so nothing was shown.`,
    "",
    "Installed screens, as plugin and action:",
    ...installed.map(
      ({ plugin, action, description }) =>
        `  ${plugin} ${action}: ${description}`,
    ),
    "",
    "Call again with plugin and action set to one of them, or ask a plain question with questions instead.",
  ].join("\n");
}

export const DISCOVER_DESCRIPTION =
  "Find a plugin for something the person wants that none of your other tools obviously does. Pass query with what they asked for, in their words, or group to list every plugin in that group. A screen it finds is then shown to the person with question({ plugin, action, input }).";

export const DISCOVER_NEEDS_ONE =
  "Pass one of query, with what the person asked for, group, or plugin.";

export const DISCOVER_ACTION_NEEDS_PLUGIN =
  "Pass action with the plugin whose action it is.";

/** What discover's listing ends with: how to read an action in full. */
export const DISCOVER_MORE =
  "For an action's full guidance and the input it takes, call discover({ plugin, action }); discover({ plugin }) gives all of a plugin's.";

/** A specialist as discover lists it: a line for it, then one for each action. */
export const specialistListing = (
  handle: string,
  description: string,
  actions: readonly {
    action: string;
    screen: boolean;
    when: string;
    now: string;
  }[],
) =>
  [
    `${handle}: ${description}`,
    ...actions.map(
      ({ action, screen, when, now }) =>
        `  ${action}${screen ? " (screen)" : ""}: ${when} Now: ${now}.`,
    ),
  ].join("\n");

/** A route as discover lists it: a line for it, then one for each step. */
export const routeListing = (
  handle: string,
  description: string,
  following: boolean,
  steps: readonly { name: string; readiness: string }[],
) =>
  [
    `${handle} (route): ${description} ${following ? "This project follows it." : `execute({ plugin: "${handle}" }) has the project follow it.`}`,
    ...steps.map(({ name, readiness }) => `  step ${name}: ${readiness}.`),
  ].join("\n");

export const noActionFound = (
  handle: string,
  asked: string,
  actions: readonly string[],
) =>
  actions.length === 0
    ? `${handle} has no actions. Call discover({ plugin: "${handle}" }) for its guidance.`
    : `${handle} has no action ${JSON.stringify(asked)}. Its actions: ${actions.join(", ")}. Call discover again with one of them.`;

// Each plugin found, with what status says of it for the project when discover knows the project.
export const foundPlugins = (
  found: readonly Plugin[],
  status: (plugin: Plugin) => string[] = () => [],
) =>
  found
    .map((plugin) =>
      [
        `${plugin.builder.handle} runs a ${plugin.builder.runs}. Groups: ${plugin.builder.groups.join(", ")}.`,
        plugin.guidance,
        ...status(plugin),
      ].join("\n"),
    )
    .join("\n\n");

export function noPluginFound(
  asked: { query?: string; group?: string; plugin?: string },
  groups: ReadonlyMap<string, readonly Plugin[]>,
): string {
  let missing = `No plugin matches ${JSON.stringify(asked.query)}.`;
  if (asked.group !== undefined)
    missing = `No plugin is in the group ${JSON.stringify(asked.group)}.`;
  if (asked.plugin !== undefined)
    missing = `No plugin is called ${JSON.stringify(asked.plugin)}.`;
  return [
    missing,
    "",
    "Groups:",
    ...[...groups].map(
      ([group, plugins]) =>
        `  ${group}: ${plugins.map(({ builder, description }) => `${builder.handle} (${description})`).join("; ")}`,
    ),
    "",
    "Call again with group set to one of them, or carry on without a plugin.",
  ].join("\n");
}

// Appended after the person's words, so the person's view strips from the lead to the end.
export const PLUGIN_HINT_LEAD =
  "\n\nBuilder's note, not written by the person: Builder noticed plugins that may fit this message.";
export const PLUGIN_HINT_END =
  "If none fits, call discover or carry on without a plugin.";

export const pluginHint = (screens: readonly ScreenAction[]) =>
  [
    PLUGIN_HINT_LEAD,
    ...screens.map(
      ({ name, plugin, action, description }) =>
        `- ${name}: ${description} Open it with question({ plugin: "${plugin}", action: "${action}" }); Builder supplies the values it reads.`,
    ),
    PLUGIN_HINT_END,
  ].join("\n");

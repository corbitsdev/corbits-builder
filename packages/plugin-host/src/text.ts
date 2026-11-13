import {
  FileValue,
  inputText,
  LinkValue,
  type CheckActionBuilder,
  type Fact,
  type Field,
  type ValueDeclaration,
} from "@corbits-builder/plugin";
import type { Choice, Plugin, ScreenAction } from "./catalog.ts";

// A fact in plain words, as the catalog has it from the plugins.
type FactText = (fact: Fact) => string;

// What the coordinator reads about execute, the facts an action requires, and why nothing started.

export const EXECUTE_DESCRIPTION =
  "Start a specialist's action, run a check, or open a screen for the person, by the plugin's handle and the action's name as discover lists them. A workflow action starts its specialist and returns at once with { started, runs: [{ runId }], presents, advice }, where advice is what its plan step suggested doing first; each run's report arrives later as a message that begins with its run id. Independent pieces of work can start in the same turn, one execute each. A check returns its record, { ran, result, summary, evidence }, or, for one that keeps trying, its checkId now and its result later as a hub note. A screen waits for the person and returns { output }, their answer, or { reply } when they wrote back instead. When the person's approval is all that holds a start back and one screen gives it, execute shows that screen and starts the action once they answer; if they write back instead, nothing starts. A refusal starts nothing and says why. When the action lacks something, it names which action makes it true: start that first or ask the person. When the person declined the action's plan step, or asked to be consulted before it, carry on with the rest of the plan. A ready-made plan is added with the plan tool, not started here.";

export const RUNS_DESCRIPTION =
  "See and steer the runs you started with execute. list returns each run you started in this project that is at work or ended lately, with its plugin and action, status, state while it runs, when it started, its last activity, and why a failed run stopped. wait returns which of runIds ended and which still work, once the first ends or the time is up. You need not wait for a report: it reaches you as a message after your turn. stop returns which runs it stopped and which had already ended; what a stopped run filed or pushed is kept. A run id that is not one of yours is refused with the list of yours.";

export const PLAN_DESCRIPTION =
  "Keep the project's plan, which shows the person what is coming and where work of several steps stands, and holds each step until what it waits for is true. It is the only way a plan is set. Each operation answers with the plan as it now stands, each step with its id; pass that id as execute's step when you start the step. Write a plan of your own with set from the actions that fit, which is the normal case, or take up a ready-made plan with add and plan, which also has the project follow it while its group is on the plan. Once added, a ready-made plan's steps can be adjusted like any others: add your own before, after or between them, inside its group or next to it, and remove those that do not fit. A refusal saves nothing. It names each wrong field, or the first step the plan cannot hold, such as an action that is not installed or an input that does not fit: correct it and call again. Adding a ready-made plan whose work is already done is refused too: start the action the person's request needs directly.";

// What runs offers for a run that holds back the next one, named as runIds lists it.
export const waitOrStop = (runIds: string) =>
  `runs({ operation: "wait", runIds: [${runIds}] }) waits for it to end, or runs({ operation: "stop", runIds: [${runIds}] }) stops it; then call execute again.`;

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
        `- ${name} (${[values.get(name)?.type].flat().join(" or ")}): ${values.get(name)?.about}`,
    ),
  ].join("\n");

export const DISCOVER_DYNAMIC_DESCRIPTION =
  'Find what you can do for the person: every piece of work you can start is a plugin. Pass query with what they asked for, in their words, or group to list every plugin in that group. Each plugin comes in a line, with a line for each action saying what it is for and whether it can start or open now, or what it needs first. The project\'s values follow. Pass plugin, and action, for that action\'s full guidance and the input it takes; read it before you first start or open an action. Specialist actions are started with execute. A ready-made plan is taken up with plan({ operation: "add", plan: handle }), which puts its steps on the project\'s plan. When none fits, write the plan yourself with plan({ operation: "set", steps }) from the actions that do. A screen action is shown to the person with execute({ plugin, action, input }).';

/** Missing facts that together make one alternative, with the installed actions that make them true. */
const missingText = (
  facts: readonly Fact[],
  makers: readonly string[],
  factText: FactText,
) =>
  facts.map(factText).join(" and ") +
  (makers.length > 0
    ? ` (${[...new Set(makers)].join(" or ")} makes this true)`
    : "");

const missingLine = (
  facts: readonly Fact[],
  makers: readonly string[],
  factText: FactText,
) => `  - ${missingText(facts, makers, factText)}`;

/**
 * What an action lacks of its own requirements: each missing fact, or each alternative when it has
 * several, in plain words with what makes it true.
 */
export const missingTexts = (
  own: readonly (readonly Fact[])[],
  makers: (fact: Fact) => string[],
  factText: FactText,
) =>
  (own.length === 1 ? own[0]!.map((fact) => [fact]) : own).map((facts) =>
    missingText(facts, facts.flatMap(makers), factText),
  );

/** Why a plan step whose run completed has not finished: what it makes true does not hold. */
export const unfinishedText = (missing: readonly Fact[], factText: FactText) =>
  `Its run ended, but ${missing.map(factText).join(" and ")} does not hold.`;

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
        `- ${name}: ${values.get(name)?.about} ${assignedValue(value)}`,
    ),
  ].join("\n");

// A value as a run reads it: a link as its address, a file as its name and where to read it.
function assignedValue(value: unknown) {
  if (value === null) return "Not set.";
  if (LinkValue.allows(value))
    return `Value: ${value.link}\n  This is a link the person gave; what it points to is the value.`;
  if (FileValue.allows(value))
    return `Value: ${value.name ?? value.file}, a file the person attached.\n  Read it with read_artifact({ artifactId: "${value.file}" }).`;
  return `Value: ${JSON.stringify(value)}`;
}

// How much of a value discover shows; the actions that read it get all of it.
const SHOWN_VALUE = 200;

const shownValue = (value: unknown) => {
  if (value === null) return "Not set.";
  if (LinkValue.allows(value)) return `Now: ${value.link}`;
  if (FileValue.allows(value)) return `Now: ${value.name ?? value.file}`;
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

// What the plan step an action does asks of it that the project lacks: the person's go-ahead, which
// holds the step back, and the rest, which is advice.
export type StepGate = { step: string; goAhead: Fact[]; advice: Fact[] };

export type Readiness = {
  // For each of the action's own alternatives, what it still lacks; empty when one holds.
  own: Fact[][];
  // What each plan step the action does asks of it that the project lacks.
  steps: StepGate[];
};

/** Whether nothing holds an action back: what it needs of its own and the person's go-ahead. */
export const isReady = ({ own, steps }: Readiness) =>
  own.length === 0 && steps.every(({ goAhead }) => goAhead.length === 0);

/** Whether an action could start, or a screen open, now, in a line for discover and a ready-made plan's steps. */
export function readinessText(
  readiness: Readiness,
  factText: FactText,
  ready = "can start now",
) {
  const facts = (list: readonly Fact[]) => list.map(factText).join(" and ");
  const parts = isReady(readiness) ? [ready] : [];
  if (readiness.own.length > 0)
    parts.push(`needs: ${requiresText(readiness.own, factText)}`);
  for (const { step, goAhead } of readiness.steps)
    if (goAhead.length > 0)
      parts.push(
        `needs the person's go-ahead, which the step "${step}" asks for: ${facts(goAhead)}`,
      );
  for (const { step, advice } of readiness.steps)
    if (advice.length > 0)
      parts.push(`the step "${step}" suggests first: ${facts(advice)}`);
  return parts.join("; ");
}

/**
 * Why execute did not start a workflow action or show a screen, naming each missing fact and what
 * makes it true.
 */
export function unmetRequirement(
  handle: string,
  { own, steps }: Readiness,
  makers: (fact: Fact) => string[],
  factText: FactText,
  not: "started" | "shown",
) {
  const lines = [
    `${handle} was not ${not}. The project does not have what it needs yet.`,
    "",
  ];
  if (own.length > 0)
    lines.push(
      own.length === 1 ? "It needs:" : "It needs one of these:",
      ...missingTexts(own, makers, factText).map((line) => `  - ${line}`),
    );
  const holding = steps.filter(({ goAhead }) => goAhead.length > 0);
  for (const { step, goAhead } of holding) {
    if (lines.length > 2) lines.push("");
    lines.push(
      `The plan step "${step}" asks for the person's go-ahead first:`,
      ...goAhead.map((fact) => missingLine([fact], makers(fact), factText)),
    );
  }
  lines.push(
    "",
    "Start what makes these true first, or ask the person, then call execute again.",
  );
  for (const { step } of holding)
    lines.push(
      `If the person directs the work elsewhere, take the step "${step}" out of the project's plan with plan({ operation: "remove", stepIds }); its gate goes with it.`,
    );
  return lines.join("\n");
}

/** What the plan steps suggest doing before an action that started anyway, and why; empty for nothing. */
export const stepAdvice = (
  steps: readonly StepGate[],
  makers: (fact: Fact) => string[],
  factText: FactText,
) =>
  steps
    .filter(({ advice }) => advice.length > 0)
    .map(
      ({ step, advice }) =>
        `The plan step "${step}" suggests doing this first: ${advice
          .map((fact) => {
            const making = [...new Set(makers(fact))];
            return making.length > 0
              ? `${factText(fact)} (${making.join(" or ")} makes this true)`
              : factText(fact);
          })
          .join(
            "; ",
          )}. The plan orders the work so each step builds on what the one before made; this started without it.`,
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

/** Why execute did not start a step the person declined on the plan. */
export const stepDeclined = (name: string, title: string) =>
  `${name} was not started: the person declined this step ("${title}"); they can undo that on the plan. Do not start it another way; carry on with the rest of the plan.`;

/** Why execute did not start a step the person asked to be consulted on before it starts. */
export const stepAwaitsGoAhead = (name: string, title: string) =>
  `${name} was not started: the person asked to be consulted before this step ("${title}"); they give the go on the plan. Do not start it another way; carry on with the rest of the plan.`;

/** What the plan tool's answers remind the coordinator of. */
export const PLAN_STEP_REMINDER =
  "When you start one of these steps with execute, pass its id as step.";

/** The optional steps not started once every other step is done, which a done report once left out silently. */
export const optionalLeft = (titles: readonly string[], asks: boolean) => {
  const named = titles.map((title) => `"${title}"`).join(", ");
  return asks
    ? `Every other step is done. Offer these optional steps to the person as a quick yes or no before saying the work is done, and say which they left out: ${named}.`
    : `Every other step is done. The person lets you decide on these optional steps; when you say the work is done, say which you left out: ${named}.`;
};

/** The plan in a line for discover: how many steps it holds and which the person declined. */
export function planLine(
  steps: readonly { title: string; declined?: unknown }[],
) {
  if (steps.length === 0) return "Plan: none saved yet.";
  const declined = steps.filter((step) => step.declined !== undefined);
  const said =
    declined.length === 0
      ? "the person declined none"
      : `the person declined ${declined.length}, which stay undone until they restore them: ${declined.map(({ title }) => title).join(", ")}`;
  return `Plan: ${steps.length} steps; ${said}.`;
}

/** Why a ready-made plan is neither started with execute nor held as one plan step. */
export const readyPlanIsAdded = (handle: string) =>
  `${handle} is a ready-made plan, not an action, so it is neither started nor held as one step. Take it up with plan({ operation: "add", plan: "${handle}" }), which puts its steps on the project's plan as a group and has the project follow it.`;

const screenCall = (plugin: string, action: string) =>
  `execute({ plugin: "${plugin}", action: "${action}", input })`;

/** A check's guidance: what it proves, when to run it, how long it runs and what it takes. */
export function checkText(
  name: string,
  summary: string,
  {
    when,
    unless,
    failed,
  }: { when: string; unless?: string | undefined; failed: string },
  speed: CheckActionBuilder["speed"],
  { requires, input }: { requires: string; input: string },
) {
  const lines = [
    `${name} (check): ${summary}`,
    `Use it when: ${when}`,
    ...(unless === undefined ? [] : [`Not when: ${unless}`]),
    `Requires: ${requires}.`,
    input,
    `If it fails: ${failed}`,
  ];
  if (speed === undefined || speed === "person")
    lines.push(
      "Run it with execute; Builder checks the project as saved, never work in progress, and execute returns { ran, result, summary, evidence }.",
    );
  else
    lines.push(
      `Run it with execute; Builder tries it every ${speed.retry.everySeconds} seconds for up to ${speed.retry.forSeconds} seconds, so execute returns at once with its checkId and the result arrives later as a hub note.`,
    );
  if (speed === "person")
    lines.push(
      "It waits on the person: when it fails, they can fix what it names and run it again, or skip it.",
    );
  return lines.join("\n");
}

// How long ago, in words: "2 minutes ago".
function ago(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60)
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

const RAN = {
  pass: "passed",
  fail: "failed",
  skipped: "was skipped by the person",
};

/** Where a check stands, from its latest record, as discover lists it after "Now:". */
export function checkStandingText(
  latest:
    | {
        result: "pass" | "fail" | "skipped";
        summary: string;
        createdAt: string;
        current: boolean;
      }
    | undefined,
  at: number,
) {
  if (latest === undefined) return "not run yet";
  const when = ago(at - Date.parse(latest.createdAt));
  if (!latest.current)
    return `${RAN[latest.result]} ${when}, but the project has changed what it looked at since; run it again`;
  if (latest.result === "fail") return `failed: ${latest.summary}`;
  return `${RAN[latest.result]} ${when}`;
}

/** How a screen action is opened, as its guidance ends. */
export const screenText = (plugin: string, action: string) =>
  `Open it with ${screenCall(plugin, action)}.`;

/**
 * What a finished run's report tells the coordinator about the screens that can show its work to
 * the person, in Builder's note after the specialist's own words.
 */
export const presentsText = (
  plugin: string,
  screens: readonly { action: string; when: string }[],
) =>
  [
    `To show this to the person, open the ${plugin}'s screen that fits; Builder fills in the newest version itself:`,
    ...screens.map(
      ({ action, when }) => `- The ${action} screen, when: ${when}`,
    ),
  ].join("\n");

export const readyPlanDone = (handle: string, ends: Fact, factText: FactText) =>
  `${handle} was not added, so the plan was not changed: what ends it already holds (${factText(ends)}). Start the action the person's request needs directly.`;

/** A ready-made plan's guidance, how it combines with the others the project is following, and where each step stands. */
export const readyPlanFollowed = (
  handle: string,
  others: readonly string[],
  guidance: string,
  steps: readonly { name: string; readiness: string }[],
) =>
  [
    `The project is now following the ${handle} plan. It keeps following it until what ends it holds or its group is taken out of the plan.`,
    ...(others.length > 0
      ? [
          `It is also following ${others.join(", ")}. Each step on the plan waits only for the approval it carries.`,
        ]
      : []),
    "",
    guidance,
    "",
    "Where each step stands now:",
    ...steps.map(({ name, readiness }) => `  ${name}: ${readiness}`),
  ].join("\n");

export const DISCOVER_NEEDS_ONE =
  "Pass one of query, with what the person asked for, group, or plugin.";

export const DISCOVER_ACTION_NEEDS_PLUGIN =
  "Pass action with the plugin whose action it is.";

/** What discover's listing says of a plan the coordinator writes itself. */
export const DISCOVER_OWN_PLAN =
  'When no ready-made plan fits the work, write the project\'s plan yourself with plan({ operation: "set", steps }) from the actions that do.';

/** What discover's listing ends with: how to read an action in full. */
export const DISCOVER_MORE =
  "For an action's full guidance and the input it takes, call discover({ plugin, action }); discover({ plugin }) gives all of a plugin's.";

// A plugin as discover names it among the others with its handle.
const named = ({ label, package: name }: Plugin) =>
  label === name ? name : `${label} (${name})`;

/** discover's line on a handle several installed plugins share: the one the project uses and the others. */
export const choiceText = ({ handle, using, others, missing }: Choice) =>
  [
    `${handle}: using ${named(using)}; also installed: ${others.map(named).join("; ")} (the person can switch on the project's values).`,
    ...(missing === undefined
      ? []
      : [
          `The project's values select ${missing}, which is not installed, so it uses the default.`,
        ]),
  ].join(" ");

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

/** A ready-made plan as discover lists it: a line for it, then one for each step. */
export const readyPlanListing = (
  handle: string,
  description: string,
  following: boolean,
  steps: readonly { name: string; readiness: string }[],
) =>
  [
    `${handle} (ready-made plan): ${description} ${following ? "This project is following it." : `Take it up with plan({ operation: "add", plan: "${handle}" }), which puts its steps on the project's plan and has the project follow it.`}`,
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
        `- ${name}: ${description} Open it with execute({ plugin: "${plugin}", action: "${action}" }); Builder supplies the values it reads.`,
    ),
    PLUGIN_HINT_END,
  ].join("\n");

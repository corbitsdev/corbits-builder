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
  "Start a specialist plugin's action by the plugin's handle and the action's name, with the input that action's guidance from discover describes, such as { plugin: \"coder\", action: \"change\", input }. A workflow action starts its specialist and returns at once with { started, plugin, action, runs: [{ runId }], presents, advice }; each run's report arrives later as a message that begins with its run id. Independent pieces of work can start in the same turn, each with its own execute. When the start does a step of the plan, pass that step's id as step so the plan shows this run on it. Nothing starts when the action lacks what it cannot work without, the person's go-ahead that a ready-made plan the project is following asks for, or when the person declined that step on the plan; the refusal names what is missing and which plugin action makes it true. Anything else a ready-made plan suggests doing first comes back as advice with the started run. A ready-made plan takes no action: the project starts following it, and you get its guidance; input { leave: true } stops the project following it. A screen action is opened with question({ plugin, action, input }).";

export const RUNS_DESCRIPTION =
  'See and steer the runs you started with execute. operation "list" lists each run you started in this project that is at work or ended lately: its plugin and action, status, state while it runs, when it started, its last activity, and why a failed run stopped. "wait" waits up to seconds (60 unless given, at most 120) for the first of runIds to end and says which ended; a run\'s report still reaches you as a message after your turn. "stop" stops each of runIds; what a stopped run filed or pushed is kept.';

export const PLAN_DESCRIPTION =
  'Keep the project\'s plan, which shows the person where work of several steps or gates stands. Each step is either a plugin action, as discover lists it, with its input, or a group with a title that names no action and holds such steps. operation "show" returns the plan; "set" replaces it with steps; "add" appends steps, or inserts them after the step whose id is after, or with plan adds a ready-made plan by its handle as one group holding its steps, each marked optional when the person may decline it and with when it waits for their approval, and has the project follow that plan; "remove" takes out the steps whose ids are stepIds. Each answers with the plan as it now stands; pass a step\'s id as execute\'s step when you start it.';

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
  "Find what you can do for the person: every piece of work you can start is a plugin. Pass query with what they asked for, in their words, or group to list every plugin in that group: each comes in a line, with a line for each action saying what it is for and whether it can start or open now, or what it needs first, and then the project's values. Pass plugin, and action, for that action's full guidance and the input it takes; read it before you first start or open an action. Specialist actions and ready-made plans are started with execute; a screen action is shown to the person with question({ plugin, action, input }).";

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

// What a ready-made plan the project is following asks of one of its steps that the project lacks:
// the person's go-ahead, which holds the step back while they decide approvals, and the rest, which
// is advice.
export type ReadyPlanStep = { plan: string; goAhead: Fact[]; advice: Fact[] };

export type Readiness = {
  // For each of the action's own alternatives, what it still lacks; empty when one holds.
  own: Fact[][];
  // What each ready-made plan the project is following asks of this step that the project lacks.
  plans: ReadyPlanStep[];
};

/** Whether nothing holds an action back: what it needs of its own and the person's go-ahead. */
export const isReady = ({ own, plans }: Readiness) =>
  own.length === 0 && plans.every(({ goAhead }) => goAhead.length === 0);

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
  for (const { plan, goAhead } of readiness.plans)
    if (goAhead.length > 0)
      parts.push(
        `needs the person's go-ahead, which the ${plan} plan asks for: ${facts(goAhead)}`,
      );
  for (const { plan, advice } of readiness.plans)
    if (advice.length > 0)
      parts.push(`the ${plan} plan suggests first: ${facts(advice)}`);
  return parts.join("; ");
}

/**
 * Why a workflow action was not started with execute, or a screen not shown with question, naming
 * each missing fact and what makes it true.
 */
export function unmetRequirement(
  handle: string,
  { own, plans }: Readiness,
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
      ...missingTexts(own, makers, factText).map((line) => `  - ${line}`),
    );
  const holding = plans.filter(({ goAhead }) => goAhead.length > 0);
  for (const { plan, goAhead } of holding) {
    if (lines.length > 2) lines.push("");
    lines.push(
      `This project is following the ${plan} plan, which asks for the person's go-ahead first:`,
      ...goAhead.map((fact) => missingLine([fact], makers(fact), factText)),
    );
  }
  lines.push(
    "",
    `Start what makes these true first, or ask the person, then call ${tool} again.`,
  );
  for (const { plan } of holding)
    lines.push(
      `If the person directs the work elsewhere, stop following the ${plan} plan with execute({ plugin: "${plan}", input: { leave: true } }).`,
    );
  return lines.join("\n");
}

/** What the ready-made plans suggest doing before an action that started anyway, and why; empty for nothing. */
export const readyPlanAdvice = (
  plans: readonly ReadyPlanStep[],
  makers: (fact: Fact) => string[],
  factText: FactText,
) =>
  plans
    .filter(({ advice }) => advice.length > 0)
    .map(
      ({ plan, advice }) =>
        `The ${plan} plan suggests doing this first: ${advice
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

/** Why execute did not start an action for the plan step the call named. */
export function stepNotThisAction(
  name: string,
  id: string,
  named: { title: string; plugin: string; action: string } | undefined,
  fitting: readonly { id: string; title: string }[],
) {
  const said =
    named === undefined
      ? `the plan has no action step ${id}`
      : `plan step ${id} ("${named.title}") does ${named.plugin} ${named.action}, not ${name}`;
  const instead =
    fitting.length === 0
      ? `No step in the plan does ${name}: call again without step, or add the step to the plan first.`
      : `The plan's steps that do ${name}: ${fitting.map((step) => `${step.id} ("${step.title}")`).join(", ")}. Call again with the one this start does as step, or without step.`;
  return `${name} was not started: ${said}. ${instead}`;
}

/** What the plan tool's answers remind the coordinator of. */
export const PLAN_STEP_REMINDER =
  "When you start one of these steps with execute, pass its id as step.";

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

export const readyPlanTakesNoAction = (handle: string) =>
  `${handle} is a ready-made plan and takes no action, so nothing was started. Call again with no action to follow it, or name the specialist whose action you meant.`;

const questionCall = (plugin: string, action: string) =>
  `question({ plugin: "${plugin}", action: "${action}", input })`;

/** A check's guidance: what it proves, when to run it, how long it runs and what it takes. */
export function checkText(
  name: string,
  summary: string,
  {
    when,
    unless,
    speed,
  }: Pick<CheckActionBuilder, "when" | "unless" | "speed">,
  { requires, input }: { requires: string; input: string },
) {
  const lines = [
    `${name} (check): ${summary}`,
    `Use it when: ${when}`,
    ...(unless === undefined ? [] : [`Not when: ${unless}`]),
    `Requires: ${requires}.`,
    input,
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

export const readyPlanInputRefused = (handle: string, problem: string) =>
  `${handle} was not changed. Its input takes only leave: true, to stop the project following the plan; ${problem}. Call again with no input to follow it, or with { leave: true }.`;

export const readyPlanLeft = (handle: string, wasOn: boolean) =>
  wasOn
    ? `The project is no longer following the ${handle} plan, so nothing of it applies to its steps any more.`
    : `The project was not following the ${handle} plan, so nothing changed.`;

export const readyPlanDone = (handle: string, ends: Fact, factText: FactText) =>
  `${handle} was not followed: what ends it already holds (${factText(ends)}). Start the action the person's request needs directly.`;

/** A ready-made plan's guidance, how it combines with the others the project is following, and where each step stands. */
export const readyPlanFollowed = (
  handle: string,
  others: readonly string[],
  guidance: string,
  steps: readonly { name: string; readiness: string }[],
) =>
  [
    `The project is now following the ${handle} plan. It keeps following it until what ends it holds or you leave it.`,
    ...(others.length > 0
      ? [
          `It is also following ${others.join(", ")}. Where these plans share a step, the person's go-ahead any of them asks for holds the step while they decide approvals, and each plan's other advice comes with the started run.`,
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

export const DISCOVER_NEEDS_ONE =
  "Pass one of query, with what the person asked for, group, or plugin.";

export const DISCOVER_ACTION_NEEDS_PLUGIN =
  "Pass action with the plugin whose action it is.";

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
    `${handle} (ready-made plan): ${description} ${following ? "This project is following it." : `execute({ plugin: "${handle}" }) has the project follow it.`}`,
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

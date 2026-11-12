import type { Fact } from "@corbits-builder/plugin";
import type { Plugin } from "./catalog.ts";

// A fact in plain words, as the catalog has it from the plugins.
type FactText = (fact: Fact) => string;

// What the coordinator reads about execute, the facts an action requires, and why nothing started.

export const EXECUTE_DESCRIPTION =
  "Start a specialist plugin's action by the plugin's handle and the action's name, with the input that action's guidance from discover describes, such as { plugin: \"coder\", action: \"change\", input }. A workflow action starts its specialist and returns at once with the run; the outcome arrives later as the specialist's message. A route plugin takes no action: it puts the project on that route and returns its guidance and which of its steps can start now; input { leave: true } takes the project off it. When something an action needs is not true of the project yet, nothing starts, and the refusal names what is missing and which plugin action makes it true. A screen plugin is opened with question, and the writer's approve action with request_approval.";

export const DISCOVER_DYNAMIC_DESCRIPTION =
  "Find what you can do for the person: every piece of work you can start is a plugin. Pass query with what they asked for, in their words, or group to list every plugin in that group. A specialist plugin comes with its actions, how to use each, what each requires and whether the project has that now. Specialist actions and route plugins are started with execute; a screen plugin is shown to the person with question({ plugin, input }).";

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

export type Readiness = {
  // The project is following this route and the action is one of its steps.
  route?: string;
  // For each of the action's own alternatives, what it still lacks; empty when one holds.
  own: Fact[][];
  // What the route adds for this step that the project lacks.
  fromRoute: Fact[];
};

/** Whether an action could start now, in a line for discover and a route's steps. */
export function readinessText(
  { route, own, fromRoute }: Readiness,
  factText: FactText,
) {
  if (own.length === 0 && fromRoute.length === 0) return "can start now";
  const parts: string[] = [];
  if (own.length > 0) parts.push(`needs: ${requiresText(own, factText)}`);
  if (fromRoute.length > 0)
    parts.push(
      `because this project is following ${route}, it also needs: ${fromRoute.map(factText).join(" and ")}`,
    );
  return parts.join("; ");
}

/** Why a workflow action was not started, naming each missing fact and what makes it true. */
export function unmetRequirement(
  handle: string,
  { route, own, fromRoute }: Readiness,
  makers: (fact: Fact) => string[],
  factText: FactText,
) {
  const lines = [
    `${handle} was not started. The project does not have what it needs yet.`,
    "",
  ];
  if (own.length > 0)
    lines.push(
      own.length === 1 ? "It needs:" : "It needs one of these:",
      ...(own.length === 1 ? own[0]!.map((fact) => [fact]) : own).map((facts) =>
        missingLine(facts, facts.flatMap(makers), factText),
      ),
    );
  if (fromRoute.length > 0) {
    if (own.length > 0) lines.push("");
    lines.push(
      `Because this project is following ${route}, it also needs:`,
      ...fromRoute.map((fact) => missingLine([fact], makers(fact), factText)),
    );
  }
  lines.push(
    "",
    "Start what makes these true first, or ask the person, then call execute again.",
  );
  if (fromRoute.length > 0)
    lines.push(
      `If the person directs the work elsewhere, take the project off the route with execute({ plugin: "${route}", input: { leave: true } }).`,
    );
  return lines.join("\n");
}

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

export const routeTakesNoAction = (handle: string) =>
  `${handle} is a route and takes no action, so nothing was started. Call again with no action to follow it, or name the specialist whose action you meant.`;

export const screenNotExecuted = (handle: string) =>
  `${handle} is a screen, so nothing was started. A screen is opened with question({ plugin: "${handle}", input }).`;

export const toolNotExecuted = (handle: string, tool: string) =>
  `${handle} is started with its own tool, so nothing was started. Call ${tool}: only the person's answer to it records what it does.`;

export const routeInputRefused = (handle: string, problem: string) =>
  `${handle} was not changed. Its input takes only leave: true, to take the project off the route; ${problem}. Call again with no input to follow it, or with { leave: true }.`;

export const routeLeft = (handle: string, wasOn: boolean) =>
  wasOn
    ? `The project no longer follows ${handle}. Each action now needs only what it cannot work without.`
    : `The project was not following ${handle}, so nothing changed.`;

export const routeDone = (handle: string, outcome: Fact, factText: FactText) =>
  `${handle} was not followed: what it leads to already holds (${factText(outcome)}). Start the action the person's request needs directly.`;

/** A route's guidance and where each of its steps stands. */
export const routeFollowed = (
  handle: string,
  guidance: string,
  steps: readonly { name: string; readiness: string }[],
) =>
  [
    `The project now follows ${handle}. It stays on it until the outcome holds or you leave it.`,
    "",
    guidance,
    "",
    "Where each step stands now:",
    ...steps.map(({ name, readiness }) => `  ${name}: ${readiness}`),
  ].join("\n");

// What the coordinator reads when its question names a screen plugin the hub does not have.
export function unknownScreenPlugin(
  handle: string,
  installed: readonly Plugin[],
): string {
  return [
    `${JSON.stringify(handle)} is not an installed screen plugin, so nothing was shown.`,
    "",
    "Installed screen plugins:",
    ...installed.map(
      (plugin) => `  ${plugin.builder.handle}: ${plugin.description}`,
    ),
    "",
    "Call again with plugin set to one of them, or ask a plain question with questions instead.",
  ].join("\n");
}

export const DISCOVER_DESCRIPTION =
  "Find a plugin for something the person wants that none of your other tools obviously does. Pass query with what they asked for, in their words, or group to list every plugin in that group. A screen plugin is then shown to the person with question({ plugin, input }).";

export const DISCOVER_NEEDS_ONE =
  "Pass either query, with what the person asked for, or group.";

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
  asked: { query?: string; group?: string },
  groups: ReadonlyMap<string, readonly Plugin[]>,
): string {
  const missing =
    asked.group === undefined
      ? `No plugin matches ${JSON.stringify(asked.query)}.`
      : `No plugin is in the group ${JSON.stringify(asked.group)}.`;
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

export const pluginHint = (plugins: readonly Plugin[]) =>
  [
    PLUGIN_HINT_LEAD,
    ...plugins.map(({ builder, description }) =>
      builder.runs === "screen"
        ? `- ${builder.handle}: ${description} Open it with question({ plugin: "${builder.handle}" }); Builder supplies the values it reads.`
        : `- ${builder.handle}: ${description}`,
    ),
    PLUGIN_HINT_END,
  ].join("\n");

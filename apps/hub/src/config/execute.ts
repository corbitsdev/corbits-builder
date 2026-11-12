import type { Fact } from "@corbits-builder/plugin";

// What the coordinator reads about execute, the facts an action requires, and why nothing started.

export const EXECUTE_DESCRIPTION =
  "Start a specialist plugin's action by the plugin's handle and the action's name, with the input that action's guidance from discover describes, such as { plugin: \"coder\", action: \"change\", input }. A workflow action starts its specialist and returns at once with the run; the outcome arrives later as the specialist's message. A route plugin takes no action: it puts the project on that route and returns its guidance and which of its steps can start now; input { leave: true } takes the project off it. When something an action needs is not true of the project yet, nothing starts, and the refusal names what is missing and which plugin action makes it true. A screen plugin is opened with question, and the writer's approve action with request_approval.";

export const DISCOVER_DYNAMIC_DESCRIPTION =
  "Find what you can do for the person: every piece of work you can start is a plugin. Pass query with what they asked for, in their words, or group to list every plugin in that group. A specialist plugin comes with its actions, how to use each, what each requires and whether the project has that now. Specialist actions and route plugins are started with execute; a screen plugin is shown to the person with question({ plugin, input }).";

export const APP_ALREADY_EXISTS =
  "The project already has an app, so its first build is done. A change to it is coder change.";

const DOCUMENT_NAMES: Record<string, string> = {
  problem_brief: "the problem brief is",
  constraints: "the constraints are",
  approaches: "the approaches are",
  product_requirements: "the product requirements are",
  build_plan: "the build plan is",
};
const PERSON_APPROVED: Record<string, string> = {
  problem_brief: "the problem brief",
  constraints: "the constraints",
  approaches: "the approaches",
  product_requirements: "the product requirements",
  build_plan: "the build plan",
};

/** A fact in plain words. */
export function factText(fact: Fact): string {
  if (fact === "app_exists") return "the project has an app, built or imported";
  if (fact === "design_chosen")
    return "the person chose a design from the design options";
  if (fact === "filed:design_option") return "a design option is filed";
  const [state = "", kind = ""] = fact.split(":");
  const field = /^\{(\w+)\}$/.exec(kind)?.[1];
  if (field !== undefined)
    return state === "filed"
      ? `each document named in ${field} is filed`
      : `the person approved each document named in ${field}`;
  return state === "filed"
    ? `${DOCUMENT_NAMES[kind]} filed`
    : `the person approved the current version of ${PERSON_APPROVED[kind]}, or leaves approvals to you`;
}

/** Missing facts that together make one alternative, with the installed actions that make them true. */
const missingLine = (facts: readonly Fact[], makers: readonly string[]) =>
  `  - ${facts.map(factText).join(" and ")}` +
  (makers.length > 0
    ? ` (${[...new Set(makers)].join(" or ")} makes this true)`
    : "");

/** What an action requires, in plain words; each alternative is enough on its own. */
export const requiresText = (requires: readonly (readonly Fact[])[]) =>
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
export function readinessText({ route, own, fromRoute }: Readiness) {
  if (own.length === 0 && fromRoute.length === 0) return "can start now";
  const parts: string[] = [];
  if (own.length > 0) parts.push(`needs: ${requiresText(own)}`);
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
) {
  const lines = [
    `${handle} was not started. The project does not have what it needs yet.`,
    "",
  ];
  if (own.length > 0)
    lines.push(
      own.length === 1 ? "It needs:" : "It needs one of these:",
      ...(own.length === 1 ? own[0]!.map((fact) => [fact]) : own).map((facts) =>
        missingLine(facts, facts.flatMap(makers)),
      ),
    );
  if (fromRoute.length > 0) {
    if (own.length > 0) lines.push("");
    lines.push(
      `Because this project is following ${route}, it also needs:`,
      ...fromRoute.map((fact) => missingLine([fact], makers(fact))),
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

export const routeDone = (handle: string, outcome: Fact) =>
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

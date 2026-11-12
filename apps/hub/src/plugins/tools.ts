import { type } from "arktype";
import { defineTool, type AnnotatedToolFactory } from "@intx/agent/authoring";
import { questionTool } from "@intx/inference";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { Fact } from "@corbits-builder/plugin";
import {
  DISCOVER_DESCRIPTION,
  DISCOVER_NEEDS_ONE,
  foundPlugins,
  noPluginFound,
  pluginHint,
} from "../config/screen-plugins.ts";
import {
  DISCOVER_DYNAMIC_DESCRIPTION,
  EXECUTE_DESCRIPTION,
  readinessText,
  requiresText,
  routeDone,
  routeFollowed,
  routeInputRefused,
  routeLeft,
  screenNotExecuted,
  toolNotExecuted,
  unknownPlugin,
  unmetRequirement,
  type Readiness,
} from "../config/execute.ts";
import type { PluginHint } from "../environment.ts";
import {
  checkDeployments,
  projectSession,
  refusalText,
  RequestApproval,
  REQUEST_APPROVAL_DESCRIPTION,
  resolveProjectOptions,
  validArguments,
  type DeployEnv,
  type ProjectOptions,
  type ProjectSession,
} from "../projects/project-session.ts";
import { projectScopeFailure } from "../workflows/project-scope.ts";
import {
  installed,
  isRoute,
  isScreen,
  isStartable,
  isTool,
  isWorkflow,
  PLUGINS,
  ProjectRoute,
  SCREENS,
  type Plugin,
  type RoutePlugin,
  type Startable,
} from "./catalog.ts";
import { projectFacts, resolveFacts, templateField, unmet } from "./facts.ts";
import { checkPluginQuestion } from "./question.ts";
import { fields } from "./search/fields.ts";
import { triggers } from "./search/triggers.ts";
import type { Strategy } from "./search/words.ts";

// The one place the search is chosen.
const search: Strategy = fields;

const MAX_FOUND = 5;

// One object rather than a union: providers want a tool's input schema to be a plain object.
const Discover = type({
  "+": "reject",
  "query?": "string > 0",
  "group?": "string > 0",
});
const Execute = type({
  "+": "reject",
  plugin: "string > 0",
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

// What discover answers from the given plugins. Its tool asks for exactly one of query and group.
function discoverIn(
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

// The classic coordinator finds only screens, and knows nothing of the project when it does.
export const discover = (asked: typeof Discover.infer) =>
  discoverIn(SCREENS, asked);

// The least score a plugin needs to be hinted. One trigger word is all triggers can score. For fields,
// a word found in the handle, when, examples and summary ("font") scores 10, while common words
// alone ("I want to confront this problem") reach 9.
const TRIGGERS_HINT_LEAST = 1;
const FIELDS_HINT_LEAST = 10;
const HINT_SEARCHES = {
  triggers: { search: triggers, least: TRIGGERS_HINT_LEAST },
  fields: { search: fields, least: FIELDS_HINT_LEAST },
};
const MAX_HINTED = 3;

// The person's message with a note naming screens its words suggest, or unchanged when none does.
export function withPluginHint(hint: PluginHint, message: string): string {
  if (hint === "off") return message;
  const { search: hintSearch, least } = HINT_SEARCHES[hint];
  const hinted = hintSearch(message, SCREENS)
    .filter(({ score }) => score >= least)
    .slice(0, MAX_HINTED)
    .flatMap(({ handle }) =>
      SCREENS.filter((screen) => screen.builder.handle === handle),
    );
  return hinted.length === 0 ? message : message + pluginHint(hinted);
}

const discoverDefinition = (description: string) => ({
  name: "discover",
  description,
  inputSchema: { ...Discover.toJsonSchema() },
});

function checkedDiscover(raw: unknown) {
  const input = Discover(raw);
  if (input instanceof type.errors) return { error: input.summary };
  if ((input.query === undefined) === (input.group === undefined))
    return { error: DISCOVER_NEEDS_ONE };
  return { input };
}

// The classic coordinator finds what it can do from the person's wording instead of carrying every
// plugin in its prompt.
export function createPluginTools() {
  const definitions = [discoverDefinition(DISCOVER_DESCRIPTION)];
  return defineTool({
    id: "@corbits-builder/plugins/tools",
    definitions: definitions.map(({ name }) => ({ name })),
    factory: () => ({
      definitions,
      run: async (call) => {
        const { input, error } = checkedDiscover(call.arguments);
        if (!input) return { callId: call.id, content: error, isError: true };
        return { callId: call.id, content: discover(input) };
      },
    }),
  });
}

// What is true of the project, and the route it follows. A route whose outcome holds is left, so
// nothing from it applies after.
async function projectState(session: ProjectSession) {
  const listing = await session.listed();
  const facts = projectFacts(listing);
  const path = session.projectPath + "/route";
  const { route: handle } = ProjectRoute.assert(await session.hub(path));
  let route = PLUGINS.filter(isRoute).find(
    (plugin) => plugin.builder.handle === handle,
  );
  if (route && facts.has(route.builder.outcome)) {
    await session.hub(path, { route: null });
    route = undefined;
  }
  return { facts, route };
}
type ProjectState = Awaited<ReturnType<typeof projectState>>;

// Whether a plugin's finished work makes a fact true; "filed:{kind}" makes any document filed.
const makes = (made: Fact, fact: Fact) =>
  made === fact ||
  (templateField(made) !== undefined &&
    made.split(":")[0] === fact.split(":")[0]);
const makers = (fact: Fact) =>
  PLUGINS.filter(isStartable)
    .filter(({ builder }) => builder.returns.some((made) => makes(made, fact)))
    .map(({ builder }) => builder.handle);

// Where a plugin stands: what it lacks of its own requirements, for the input when there is one,
// and what the route the project follows adds for it as a step.
function readiness(
  plugin: Startable,
  { facts, route }: ProjectState,
  input?: unknown,
): Readiness {
  const requires = (plugin.builder.requires ?? []).map((alternative) =>
    input === undefined
      ? alternative.filter((fact) => templateField(fact) === undefined)
      : resolveFacts(alternative, input),
  );
  const step = route?.builder.steps.find(
    ({ plugin: handle }) => handle === plugin.builder.handle,
  );
  const readied: Readiness = {
    own: unmet(requires, facts),
    fromRoute: (step?.requires ?? []).filter((fact) => !facts.has(fact)),
  };
  if (route && step) readied.route = route.builder.handle;
  return readied;
}

// Each step of a route as if the project followed it. Only a plugin execute starts can be held.
const stepsOf = (route: RoutePlugin, facts: ProjectState["facts"]) =>
  route.builder.steps.map(({ plugin: handle }) => {
    const step = installed(handle);
    return {
      plugin: handle,
      readiness: readinessText(
        step && isStartable(step)
          ? readiness(step, { facts, route })
          : { own: [], fromRoute: [] },
      ),
    };
  });

// What discover adds about each plugin for this project.
function status(plugin: Plugin, state: ProjectState): string[] {
  if (isRoute(plugin))
    return [
      state.route === plugin
        ? "This project is following it."
        : "Start it with execute; the project then follows it.",
      "Steps:",
      ...stepsOf(plugin, state.facts).map(
        ({ plugin: handle, readiness: line }) => `  ${handle}: ${line}`,
      ),
    ];
  if (!isStartable(plugin)) return [];
  return [
    `Requires: ${requiresText(plugin.builder.requires ?? [])}.`,
    `Now: ${readinessText(readiness(plugin, state))}.`,
  ];
}

type Outcome = { content: string; isError?: true };

async function followRoute(
  session: ProjectSession,
  route: RoutePlugin,
  raw: unknown,
  state: ProjectState,
): Promise<Outcome> {
  const { handle, outcome } = route.builder;
  const input = RouteInput(raw);
  if (input instanceof type.errors)
    return { content: routeInputRefused(handle, input.summary), isError: true };
  const path = session.projectPath + "/route";
  if (input.leave) {
    if (state.route === route) await session.hub(path, { route: null });
    return { content: routeLeft(handle, state.route === route) };
  }
  if (state.facts.has(outcome)) return { content: routeDone(handle, outcome) };
  if (state.route !== route) await session.hub(path, { route: handle });
  return {
    content: routeFollowed(handle, route.guidance, stepsOf(route, state.facts)),
  };
}

// Starts a workflow plugin, or follows or leaves a route, once its input and requirements hold.
async function execute(
  session: ProjectSession,
  raw: unknown,
): Promise<Outcome> {
  const asked = Execute(raw);
  if (asked instanceof type.errors)
    return { content: asked.summary, isError: true };
  const plugin = installed(asked.plugin);
  if (!plugin)
    return {
      content: unknownPlugin(
        asked.plugin,
        PLUGINS.filter((found) => isWorkflow(found) || isRoute(found)).map(
          ({ builder }) => builder.handle,
        ),
      ),
      isError: true,
    };
  if (isScreen(plugin))
    return { content: screenNotExecuted(plugin.builder.handle), isError: true };
  if (isTool(plugin))
    return {
      content: toolNotExecuted(plugin.builder.handle, plugin.builder.tool),
      isError: true,
    };
  const state = await projectState(session);
  if (isRoute(plugin))
    return followRoute(session, plugin, asked.input ?? {}, state);
  const checked = plugin.check(asked.input ?? {});
  if (!checked.ok) return { content: checked.text, isError: true };
  const ready = readiness(plugin, state, checked.input);
  if (ready.own.length > 0 || ready.fromRoute.length > 0)
    return {
      content: unmetRequirement(plugin.builder.handle, ready, makers),
      isError: true,
    };
  return { content: JSON.stringify(await checked.start(session)) };
}

/**
 * The dynamic coordinator's way to act: discover finds a plugin, execute starts it, question opens
 * a screen, and request_approval is approve-document's own tool, because only the person's answer
 * to an asking tool records an approval.
 */
export function createExecuteTools(
  options?: ProjectOptions,
): AnnotatedToolFactory<DeployEnv> {
  if (options) checkDeployments(options.workflows);
  const definitions = [
    discoverDefinition(DISCOVER_DYNAMIC_DESCRIPTION),
    {
      name: "execute",
      description: EXECUTE_DESCRIPTION,
      inputSchema: { ...Execute.toJsonSchema() },
    },
    questionTool,
    {
      name: "request_approval",
      description: REQUEST_APPROVAL_DESCRIPTION,
      inputSchema: { ...RequestApproval.toJsonSchema() },
    },
  ];
  return defineTool<DeployEnv>({
    id: "@corbits-builder/plugins/execute",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["capabilities"],
    definitions: [
      { name: "discover" },
      { name: "execute" },
      { name: "request_approval", approval: "ask" },
    ],
    factory: (env) => ({
      definitions,
      checkQuestion: (question) =>
        checkPluginQuestion(question, env.capabilities, options),
      run: async (call, signal) => {
        if (!options) {
          try {
            return createExecuteTools(
              await resolveProjectOptions(env.capabilities, signal),
            )(env).run(call, signal);
          } catch (error) {
            return projectScopeFailure(call.id, error);
          }
        }
        const session = projectSession(env, options, signal);
        try {
          signal.throwIfAborted();
          if (call.name === "discover") {
            const { input, error } = checkedDiscover(call.arguments);
            if (!input)
              return { callId: call.id, content: error, isError: true };
            const state = await projectState(session);
            return {
              callId: call.id,
              content: discoverIn(PLUGINS, input, (plugin) =>
                status(plugin, state),
              ),
            };
          }
          if (call.name === "execute")
            return {
              callId: call.id,
              ...(await execute(session, call.arguments)),
            };
          if (call.name === "request_approval") {
            const { kinds } = validArguments(RequestApproval, call.arguments);
            const { documents } = await session.approve(kinds);
            return {
              callId: call.id,
              content: JSON.stringify({ approved: documents }),
            };
          }
          return {
            callId: call.id,
            content: "unknown_plugin_tool",
            isError: true,
          };
        } catch (error) {
          return {
            callId: call.id,
            content: refusalText(error),
            isError: true,
          };
        }
      },
    }),
  });
}

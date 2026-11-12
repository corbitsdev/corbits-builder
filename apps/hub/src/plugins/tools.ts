import { defineTool, type AnnotatedToolFactory } from "@intx/agent/authoring";
import { questionTool } from "@intx/inference";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import { ProjectRuns, ProjectValues } from "@corbits-builder/schemas/artifact";
import {
  checkedDiscover,
  Discover,
  discoverFor,
  discoverIn,
  execute,
  Execute,
  manageRuns,
  Runs,
  type Project,
} from "@corbits-builder/plugin-host/coordinator";
import { fields } from "@corbits-builder/plugin-host/search/fields";
import { triggers } from "@corbits-builder/plugin-host/search/triggers";
import { words } from "@corbits-builder/plugin-host/search/words";
import {
  DISCOVER_DESCRIPTION,
  DISCOVER_DYNAMIC_DESCRIPTION,
  EXECUTE_DESCRIPTION,
  pluginHint,
  RUNS_DESCRIPTION,
} from "@corbits-builder/plugin-host/text";
import type { PluginHint } from "../environment.ts";
import {
  checkDeployments,
  projectSession,
  refusalText,
  resolveProjectOptions,
  type DeployEnv,
  type ProjectOptions,
  type ProjectSession,
} from "../projects/project-session.ts";
import { projectScopeFailure } from "../workflows/project-scope.ts";
import { agentDecidesApprovals } from "../config/preferences.ts";
import { isInputKind, skillPacksIndex, startHere } from "../config/inputs.ts";
import { CATALOG, ProjectRoutes, SCREENS, WITH_SCREENS } from "./catalog.ts";
import { projectFacts } from "./facts.ts";
import { checkPluginQuestion } from "./question.ts";
import { startAction } from "./starters.ts";

// The classic coordinator finds only specialists with screens, and knows nothing of the project
// when it does.
export const discover = (asked: typeof Discover.infer) =>
  discoverIn(WITH_SCREENS, asked);

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

// The person's message with a note naming the screens its words suggest, or unchanged when none
// does: of each plugin its words find, the screens whose when shares one of them.
export function withPluginHint(hint: PluginHint, message: string): string {
  if (hint === "off") return message;
  const { search: hintSearch, least } = HINT_SEARCHES[hint];
  const asked = words(message);
  const hinted = hintSearch(message, WITH_SCREENS)
    .filter(({ score }) => score >= least)
    .slice(0, MAX_HINTED)
    .flatMap(({ handle }) =>
      SCREENS.filter(
        ({ plugin, builder }) =>
          plugin === handle &&
          [...words(builder.when)].some((word) => asked.has(word)),
      ),
    );
  return hinted.length === 0 ? message : message + pluginHint(hinted);
}

const discoverDefinition = (description: string) => ({
  name: "discover",
  description,
  inputSchema: { ...Discover.toJsonSchema() },
});

// The project as the coordinator's tools act on it, through the hub.
function project(session: ProjectSession): Project {
  const path = session.projectPath + "/routes";
  return {
    state: async () => {
      const listed = await session.listed();
      return {
        facts: projectFacts(listed),
        asksApprovals: !agentDecidesApprovals(listed.preferences),
      };
    },
    routes: async () => ProjectRoutes.assert(await session.hub(path)).routes,
    setRoutes: (routes) => session.hub(path, { routes }),
    values: async (names) =>
      ProjectValues.assert(
        await session.hub(
          `${session.projectPath}/values?${new URLSearchParams({ keys: names.join(",") })}`,
        ),
      ).values,
    start: (action, input, values) => {
      const assigned = session.forAction({
        plugin: action.plugin,
        action: action.action,
        values,
      });
      const skills = skillPacksIndex(action.packs);
      if (action.starter)
        return action.starter.run(
          action.builder.start,
          input,
          project(assigned),
          skills,
        );
      return startAction(action, input, assigned, skills);
    },
    runs: async () =>
      ProjectRuns.assert(await session.hub(session.projectPath + "/runs")).runs,
    stop: (runId) =>
      session.hub(
        `${session.projectPath}/runs/${encodeURIComponent(runId)}/stop`,
        {},
      ),
    working: async () => (await session.listed()).inFlight,
    startAlone: ({ workflow, correlation, assignment, busy }) =>
      session.startAlone(
        workflow,
        correlation,
        ({ byKind }) =>
          assignment({
            startHere: (kinds, design) => {
              const unknown = kinds.find((kind) => !isInputKind(kind));
              if (unknown !== undefined)
                throw new Error(`${unknown} is not a document Builder stages`);
              const filed = kinds
                .filter(isInputKind)
                .filter((kind) => byKind.has(kind));
              const version = design
                ? byKind.get("design")?.version
                : undefined;
              if (filed.length === 0 && version === undefined) return undefined;
              return startHere(session.inputs(filed, byKind), version);
            },
          }),
        busy,
      ),
  };
}

/** The coordinator's project, as a screen its question opens is checked against. */
export async function screenProject(
  env: DeployEnv,
  options: ProjectOptions | undefined,
) {
  const signal = new AbortController().signal;
  return project(
    projectSession(
      env,
      options ?? (await resolveProjectOptions(env.capabilities, signal)),
      signal,
    ),
  );
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
        const { input, error } = checkedDiscover(WITH_SCREENS, call.arguments);
        if (!input) return { callId: call.id, content: error, isError: true };
        return { callId: call.id, content: discover(input) };
      },
    }),
  });
}

/**
 * The dynamic coordinator's way to act: discover finds a plugin, execute starts a specialist's
 * action or a route, runs lists, waits on and stops the runs it started, and question opens a
 * screen, whose answer records what it approves.
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
    {
      name: "runs",
      description: RUNS_DESCRIPTION,
      inputSchema: { ...Runs.toJsonSchema() },
    },
    questionTool,
  ];
  return defineTool<DeployEnv>({
    id: "@corbits-builder/plugins/execute",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["capabilities"],
    definitions: [{ name: "discover" }, { name: "execute" }, { name: "runs" }],
    factory: (env) => ({
      definitions,
      checkQuestion: async (question) =>
        checkPluginQuestion(question, await screenProject(env, options)),
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
            const { input, error } = checkedDiscover(
              CATALOG.plugins,
              call.arguments,
            );
            if (!input)
              return { callId: call.id, content: error, isError: true };
            return {
              callId: call.id,
              content: await discoverFor(CATALOG, project(session), input),
            };
          }
          if (call.name === "execute")
            return {
              callId: call.id,
              ...(await execute(CATALOG, project(session), call.arguments)),
            };
          if (call.name === "runs")
            return {
              callId: call.id,
              ...(await manageRuns(project(session), call.arguments, signal)),
            };
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

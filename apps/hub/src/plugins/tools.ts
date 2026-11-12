import { defineTool, type AnnotatedToolFactory } from "@intx/agent/authoring";
import { questionTool } from "@intx/inference";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import { ProjectValues } from "@corbits-builder/schemas/artifact";
import {
  checkedDiscover,
  Discover,
  discoverFor,
  discoverIn,
  execute,
  Execute,
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
} from "@corbits-builder/plugin-host/text";
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
import { CATALOG, ProjectRoute, SCREENS, WITH_SCREENS } from "./catalog.ts";
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
  const path = session.projectPath + "/route";
  return {
    facts: async () => projectFacts(await session.listed()),
    route: async () => ProjectRoute.assert(await session.hub(path)).route,
    setRoute: (route) => session.hub(path, { route }),
    values: async (names) =>
      ProjectValues.assert(
        await session.hub(
          `${session.projectPath}/values?${new URLSearchParams({ keys: names.join(",") })}`,
        ),
      ).values,
    start: (action, input, values) =>
      startAction(action, input, session, values),
  };
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

/**
 * The dynamic coordinator's way to act: discover finds a plugin, execute starts a specialist's
 * action or a route, question opens a screen, and request_approval is the writer's approve action,
 * because only the person's answer to an asking tool records an approval.
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

import { defineTool, type AnnotatedToolFactory } from "@intx/agent/authoring";
import { questionTool } from "@intx/inference";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import {
  CheckList,
  CheckRan,
  ProjectRuns,
  ProjectValues,
} from "@corbits-builder/schemas/artifact";
import {
  checkedDiscover,
  Discover,
  discoverFor,
  execute,
  Execute,
  managePlan,
  manageRuns,
  Plan,
  Runs,
  type Filed,
  type Project,
} from "@corbits-builder/plugin-host/coordinator";
import { fields } from "@corbits-builder/plugin-host/search/fields";
import { triggers } from "@corbits-builder/plugin-host/search/triggers";
import { words } from "@corbits-builder/plugin-host/search/words";
import {
  DISCOVER_DYNAMIC_DESCRIPTION,
  EXECUTE_DESCRIPTION,
  PLAN_DESCRIPTION,
  pluginHint,
  RUNS_DESCRIPTION,
} from "@corbits-builder/plugin-host/text";
import { PlanView } from "@corbits-builder/schemas/project";
import type { PluginHint } from "../environment.ts";
import {
  checkDeployments,
  projectSession,
  refusalText,
  resolveProjectOptions,
  type DeployEnv,
  type ProjectListing,
  type ProjectOptions,
  type ProjectSession,
} from "../projects/project-session.ts";
import { projectScopeFailure } from "../workflows/project-scope.ts";
import { agentDecidesApprovals } from "../config/preferences.ts";
import { isInputKind, skillPacksIndex, startHere } from "../config/inputs.ts";
import { CATALOG, ProjectRoutes, SCREENS, WITH_SCREENS } from "./catalog.ts";
import { projectFacts } from "./facts.ts";
import { checkPluginQuestion } from "./question.ts";

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

// The project as it stands when a run's assignment is written, from the documents filed in it.
function filed(
  session: ProjectSession,
  { byKind }: Pick<ProjectListing, "byKind">,
): Filed {
  return {
    versions: byKind,
    read: session.readSource,
    design: session.readDesign,
    startHere: (kinds, design) => {
      const unknown = kinds.find((kind) => !isInputKind(kind));
      if (unknown !== undefined)
        throw new Error(`${unknown} is not a document Builder stages`);
      const staged = kinds
        .filter(isInputKind)
        .filter((kind) => byKind.has(kind));
      const version = design ? byKind.get("design")?.version : undefined;
      if (staged.length === 0 && version === undefined) return undefined;
      return startHere(session.inputs(staged, byKind), version);
    },
  };
}

// A check runs within its action's ms on the hub; the call waits a little longer for its answer.
const CHECK_CALL_GRACE_MS = 15_000;

// The project as the coordinator's tools act on it, through the hub.
function project(session: ProjectSession): Project {
  const path = session.projectPath + "/routes";
  return {
    state: async () => {
      const listed = await session.listed();
      const { checks } = CheckList.assert(
        await session.hub(session.projectPath + "/checks"),
      );
      return {
        facts: projectFacts({
          artifacts: listed.artifacts,
          preferences: listed.preferences,
          checks,
        }),
        asksApprovals: !agentDecidesApprovals(listed.preferences),
        checks,
        preferences: listed.preferences,
      };
    },
    check: async (action, input) =>
      CheckRan.assert(
        await session.hub(
          session.projectPath + "/check-runs",
          { plugin: action.plugin, action: action.action, input },
          action.ms + CHECK_CALL_GRACE_MS,
        ),
      ),
    routes: async () => ProjectRoutes.assert(await session.hub(path)).routes,
    setRoutes: (routes) => session.hub(path, { routes }),
    values: async (names) =>
      ProjectValues.assert(
        await session.hub(
          `${session.projectPath}/values?${new URLSearchParams({ keys: names.join(",") })}`,
        ),
      ).values,
    start: (action, input, values) =>
      action.starter.run(
        action.builder.start,
        input,
        project(
          session.forAction({
            plugin: action.plugin,
            action: action.action,
            values,
          }),
        ),
        skillPacksIndex(action.packs),
      ),
    runs: async () =>
      ProjectRuns.assert(await session.hub(session.projectPath + "/runs")).runs,
    stop: (runId) =>
      session.hub(
        `${session.projectPath}/runs/${encodeURIComponent(runId)}/stop`,
        {},
      ),
    plan: async () =>
      PlanView.assert(await session.hub(session.projectPath + "/plan")),
    savePlan: (steps) =>
      session.hub(session.projectPath + "/plan", { steps }, undefined, "PUT"),
    working: async () => (await session.listed()).inFlight,
    startAlone: ({ workflow, correlation, assignment, busy }) =>
      session.startAlone(
        workflow,
        correlation,
        (state) => assignment(filed(session, state)),
        busy,
      ),
    deploy: async ({ workflow, correlation, assignment, record }) => {
      const { role, spec } = session.installed(workflow);
      const state = await session.listed();
      const now = filed(session, state);
      const content = await assignment(now);
      const data = await record?.data(now);
      return session.deploy(
        role,
        spec,
        state.preferences,
        correlation,
        content,
        record &&
          ((runId) =>
            session.hub(session.projectPath + "/run-records", {
              runId,
              name: record.name,
              data,
            })),
      );
    },
    startConcepts: ({ workflow, correlation, concepts, assignment, busy }) =>
      session.startConcepts(
        workflow,
        correlation,
        concepts,
        (state, concept) => assignment(filed(session, state), concept),
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

/**
 * The coordinator's way to act: discover finds a plugin, execute starts a specialist's
 * action or a route, runs lists, waits on and stops the runs it started, plan keeps the project's
 * plan, and question opens a screen, whose answer records what it approves.
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
    {
      name: "plan",
      description: PLAN_DESCRIPTION,
      inputSchema: { ...Plan.toJsonSchema() },
    },
    questionTool,
  ];
  return defineTool<DeployEnv>({
    id: "@corbits-builder/plugins/execute",
    credentials: [{ handle: HUB_CREDENTIAL_HANDLE }],
    requires: ["capabilities"],
    definitions: [
      { name: "discover" },
      { name: "execute" },
      { name: "runs" },
      { name: "plan" },
    ],
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
          if (call.name === "plan")
            return {
              callId: call.id,
              ...(await managePlan(CATALOG, project(session), call.arguments)),
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

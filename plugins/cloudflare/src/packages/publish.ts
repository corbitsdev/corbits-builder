import { type } from "arktype";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { EffectContext } from "@intx/workflow";
import {
  action,
  defineWorkflow,
  gate,
  type ActionHandler,
} from "@intx/workflow/definition";
import { CheckRan } from "@corbits-builder/schemas/artifact";
import { mediatedHttpJson } from "@corbits-builder/hub/workflows/http-json";
import { CHECK_MS } from "@corbits-builder/plugin-host/checks";

// The effect each check step performs: asking the hub to run one of this plugin's checks.
const RUN_CHECK = "run-check";
// A check runs within CHECK_MS on the hub; the call waits a little longer for its answer, as the
// coordinator's own check call does.
const CHECK_CALL_MS = CHECK_MS + 15_000;
const MAX_RESPONSE_BYTES = 65_536;

// The project a run works in, as the hub's scope route tells it; the rest of the scope is for agents.
const RunScope = type({ tenantId: "string > 0", projectId: "string > 0" });

// Runs one cloudflare check against the project as saved, through the hub as this run. Its output
// carries whether it passed, for a gate, and its result under the check's name, for the outcome.
// The check itself stays in the hub; the workflow only orders and gates.
async function runCheck(
  name: "ready" | "routes",
  ctx: EffectContext,
  signal: AbortSignal,
) {
  const ran = CheckRan.assert(
    await ctx.perform({
      effectId: "check-" + name,
      capability: RUN_CHECK,
      run: async ({ credentials }) => {
        const credential = await credentials.resolve(HUB_CREDENTIAL_HANDLE);
        const { tenantId, projectId } = RunScope.assert(
          await mediatedHttpJson({
            credential,
            path: "/api/workflow-project-scope",
            maxResponseBytes: MAX_RESPONSE_BYTES,
            signal,
          }),
        );
        return mediatedHttpJson({
          credential,
          path: `/api/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}/check-runs`,
          body: { plugin: "cloudflare", action: name },
          maxResponseBytes: MAX_RESPONSE_BYTES,
          signal,
          timeoutMs: CHECK_CALL_MS,
        });
      },
    }),
  );
  // Neither check keeps trying, so the hub answers with its result.
  if (!("result" in ran))
    throw new Error(`cloudflare ${name} answered without a result`);
  return {
    passed: ran.result === "pass",
    [name]: {
      result: ran.result,
      checkId: ran.checkId,
      summary: ran.summary,
      evidence: ran.evidence,
    },
  };
}

// Each handler is a bare export of this module, which the package names as its actions module.
export const checkReady: ActionHandler = (_input, ctx, signal) =>
  runCheck("ready", ctx, signal);
export const checkRoutes: ActionHandler = (_input, ctx, signal) =>
  runCheck("routes", ctx, signal);
// The run's outcome is its last step's output: what that step was given.
export const outcome: ActionHandler = async (input) => input;

// The checks that ran, each by its name, and whether the app is published.
const ended = (
  published: boolean,
  checks: readonly ("ready" | "routes")[],
) => ({
  merge: [
    { literal: { published } },
    ...checks.map((name) => ({
      project: { from: `steps.${name}.output` },
      fields: [name],
    })),
  ],
});

// Publishing to Cloudflare, with no agent: the ready check, then the routes check once ready
// passes. A failed check ends the run with its result. A check that could not run at all routes
// to its own end, since a failed action does not stop the steps after it, both gate branches
// included.
export default defineWorkflow({
  id: "corbits-builder-cloudflare-publish",
  mailAccept: { invoker: true },
  triggers: [{ type: "mail", to: "cloudflare-publish" }],
  steps: {
    ready: action({
      handler: "checkReady",
      credentials: [HUB_CREDENTIAL_HANDLE],
      effect: { requires: [RUN_CHECK] },
      onFailure: "readyFailed",
    }),
    readyFailed: action({
      after: ["ready"],
      handler: "outcome",
      input: { literal: { published: false, failed: "ready" } },
    }),
    readyPassed: gate({
      after: ["ready"],
      when: { from: "steps.ready.output.passed" },
      // oxlint-disable-next-line unicorn/no-thenable -- Interchange's gate names its branches then and else.
      then: "routes",
      else: "notReady",
    }),
    notReady: action({
      after: ["readyPassed"],
      handler: "outcome",
      input: ended(false, ["ready"]),
    }),
    routes: action({
      after: ["readyPassed"],
      handler: "checkRoutes",
      credentials: [HUB_CREDENTIAL_HANDLE],
      effect: { requires: [RUN_CHECK] },
      onFailure: "routesFailed",
    }),
    routesFailed: action({
      after: ["routes"],
      handler: "outcome",
      input: { literal: { published: false, failed: "routes" } },
    }),
    routesPassed: gate({
      after: ["routes"],
      when: { from: "steps.routes.output.passed" },
      // oxlint-disable-next-line unicorn/no-thenable -- Interchange's gate names its branches then and else.
      then: "published",
      else: "notRouted",
    }),
    notRouted: action({
      after: ["routesPassed"],
      handler: "outcome",
      input: ended(false, ["ready", "routes"]),
    }),
    published: action({
      after: ["routesPassed"],
      handler: "outcome",
      input: ended(true, ["ready", "routes"]),
    }),
  },
});

import { type } from "arktype";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { LoopFn } from "@intx/workflow";
import type { ActionHandler } from "@intx/workflow/definition";
import { CheckRan } from "@corbits-builder/schemas/artifact";
import { mediatedHttpJson } from "@corbits-builder/hub/workflows/http-json";
import { CHECK_MS } from "@corbits-builder/plugin-host/checks";

// The effect the done step performs: asking the hub to run one of the coder's checks.
export const RUN_CHECK = "run-check";
// A check runs within CHECK_MS on the hub; the call waits a little longer for its answer.
const CHECK_CALL_MS = CHECK_MS + 15_000;
const MAX_RESPONSE_BYTES = 65_536;

// The project a run works in, as the hub's scope route tells it; the rest of the scope is for agents.
const RunScope = type({ tenantId: "string > 0", projectId: "string > 0" });
const DoneInput = type({ checks: type("string > 0").array().atLeastLength(1) });
const Result = type({
  check: "string",
  result: "'pass' | 'fail'",
  summary: "string",
  evidence: "string[]",
});
// One pass as the loop sees it: each body step's output under its step id.
const Pass = type({ done: { passed: "boolean", results: Result.array() } });
// A later pass's input: the assignment the run was started with and the checks that failed.
const Again = type({ assignment: "unknown", failed: Result.array() });

/**
 * Runs each check the action's done names against the app as saved, through the hub as this run,
 * and says whether all of them passed, with each one's result and evidence.
 */
export const runDoneChecks: ActionHandler = async (input, ctx, signal) => {
  const results = [];
  for (const check of DoneInput.assert(input).checks) {
    const ran = CheckRan.assert(
      await ctx.perform({
        effectId: "check-" + check,
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
            body: { plugin: "coder", action: check },
            maxResponseBytes: MAX_RESPONSE_BYTES,
            signal,
            timeoutMs: CHECK_CALL_MS,
          });
        },
      }),
    );
    if (!("result" in ran))
      throw new Error(`coder ${check} answered without a result`);
    results.push({
      check,
      result: ran.result,
      summary: ran.summary,
      evidence: ran.evidence,
    });
  }
  return {
    passed: results.every(({ result }) => result === "pass"),
    results,
  };
};

// The loop goes round again while a done check failed.
export const checksFailed: LoopFn = (output) =>
  !Pass.assert(output).done.passed;

// The next pass works on the same assignment, told which checks failed and why.
export const sendBack: LoopFn = (output, input) => {
  const again = Again(input);
  return {
    assignment: again instanceof type.errors ? input : again.assignment,
    failed: Pass.assert(output).done.results.filter(
      ({ result }) => result === "fail",
    ),
  };
};

// Every pass ended with a check failing: the run ends not finished, the last evidence its reason.
export const notFinished: ActionHandler = async (input) => {
  const failed = Pass.assert(input)
    .done.results.filter(({ result }) => result === "fail")
    .map(
      ({ check, summary, evidence }) =>
        `coder ${check}: ${summary}${evidence.length > 0 ? ` (${evidence.join("; ")})` : ""}`,
    );
  throw new Error(`The work is not finished: ${failed.join(" ")}`);
};

import { getLogger } from "@intx/log";
import { parseAddress } from "@intx/types/agent-address";
import { requestErrorMetadata } from "../request-error.ts";
import type { createRunExport } from "./run-export.ts";
import {
  runIdFromLocalPart,
  type createRunSpans,
  type RunSpanAgent,
} from "./run-spans.ts";

const log = getLogger(["corbits-builder", "telemetry"]);

export type RunContext = Pick<
  RunSpanAgent,
  "tenantId" | "projectId" | "role" | "effort" | "profile" | "packageVersion"
>;

const MAX_KNOWN_RUNS = 1000;

export function createRunTracing(options: {
  events: {
    on(
      name: "agent.event",
      listener: (frame: { agentAddress: string; event: unknown }) => void,
    ): () => void;
  };
  runSpans: ReturnType<typeof createRunSpans>;
  runExport: NonNullable<ReturnType<typeof createRunExport>>;
  describeRun: (runId: string) => Promise<RunContext>;
}) {
  const { runSpans, runExport, describeRun } = options;
  const known = new Map<string, RunContext>();
  // An event waits for the one before it in its run, so spans keep arrival order across the lookup.
  const tails = new Map<string, Promise<void>>();

  async function contextOf(runId: string): Promise<RunContext> {
    const context = known.get(runId);
    if (context) return context;
    const found = await describeRun(runId);
    // A run seen before its row exists is asked about again on its next event.
    if (found.tenantId === undefined) return found;
    known.set(runId, found);
    if (known.size > MAX_KNOWN_RUNS) {
      const oldest = known.keys().next().value;
      if (oldest !== undefined) known.delete(oldest);
    }
    return found;
  }

  async function trace(
    previous: Promise<void> | undefined,
    runId: string,
    address: string,
    event: unknown,
    at: number,
  ): Promise<void> {
    await previous;
    try {
      const context = await contextOf(runId);
      runExport.send(
        runSpans.accept(
          {
            address,
            runId,
            tenantId: context.tenantId,
            projectId: context.projectId,
            role: context.role,
            effort: context.effort,
            profile: context.profile,
            packageVersion: context.packageVersion,
          },
          event,
          at,
        ),
      );
    } catch (error) {
      log.error("Agent trace event failed", requestErrorMetadata(error));
    }
  }

  async function forget(runId: string, tail: Promise<void>): Promise<void> {
    await tail;
    if (tails.get(runId) === tail) tails.delete(runId);
  }

  const unsubscribe = options.events.on(
    "agent.event",
    ({ agentAddress, event }) => {
      const address = parseAddress(agentAddress);
      if (!address) return;
      const runId = runIdFromLocalPart(address.localPart);
      if (!runId) return;
      const tail = trace(
        tails.get(runId),
        runId,
        agentAddress,
        event,
        Date.now(),
      );
      tails.set(runId, tail);
      void forget(runId, tail);
    },
  );

  return {
    async dispose(): Promise<void> {
      unsubscribe();
      await Promise.all(tails.values());
      runExport.send(runSpans.shutdown(Date.now()));
    },
  };
}

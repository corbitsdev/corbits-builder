import { afterEach, expect, setSystemTime, test } from "bun:test";
import type { DB } from "@intx/db";
import { workflowRun } from "@intx/db/schema";
import type { SidecarAllocationStatus } from "@intx/types";
import { awaitCoordinatorReady } from "./coordinator-startup.ts";

const run = {
  id: "run",
  anchorRunId: "run",
  address: "run@tenant",
  status: "running",
  expiresAt: null,
  cancellationRequestedAt: null,
};

// Each poll reads the next allocation status, then moves the clock on by `stepMs`.
function nativeStates(statuses: SidecarAllocationStatus[], stepMs: number) {
  let polls = 0;
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === workflowRun) return [run];
          const status = statuses[Math.min(polls, statuses.length - 1)];
          polls += 1;
          setSystemTime(new Date(Date.now() + stepMs));
          return [{ status, nextAttemptAt: null }];
        },
      }),
    }),
  };
  return db as unknown as DB["db"];
}

afterEach(() => {
  setSystemTime();
});

test("a coordinator ready after more than 120 s still starts", async () => {
  await awaitCoordinatorReady(
    nativeStates(["provisioning", "allocated"], 121_000),
    "tenant",
    "run",
  );
});

test("a start still pending past 270 s fails", async () => {
  await expect(
    awaitCoordinatorReady(
      nativeStates(["provisioning"], 271_000),
      "tenant",
      "run",
    ),
  ).rejects.toMatchObject({ code: "coordinator_start_failed" });
});

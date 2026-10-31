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

test("a start still pending past the limit fails and cancels the run", async () => {
  const cancelled: string[][] = [];
  await expect(
    awaitCoordinatorReady(
      nativeStates(["provisioning"], 61_000),
      "tenant",
      "run",
      60_000,
      async (...args) => {
        cancelled.push(args);
      },
    ),
  ).rejects.toMatchObject({ code: "coordinator_start_failed" });
  expect(cancelled).toEqual([["tenant", "run", "coordinator_start_timeout"]]);
});

test("a raised limit lets a 90 s start finish", async () => {
  await awaitCoordinatorReady(
    nativeStates(["provisioning", "allocated"], 90_000),
    "tenant",
    "run",
    120_000,
    async () => {},
  );
});

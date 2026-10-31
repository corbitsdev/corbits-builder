import { schema, type DB } from "@intx/db";
import type {
  SidecarProvisioner,
  SidecarProvisionerChooser,
} from "@intx/hub-sessions";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { createSerialQueue } from "../lib/serial-queue.ts";

type CreatePlacementChooserOpts = {
  readonly db: DB["db"];
  readonly local: SidecarProvisioner;
  /** The active deployments the local sidecar advertises. */
  readonly maxDeployments: number;
  readonly now?: () => number;
};

/**
 * How long a local pick counts before its allocation row does. The row is written right after the chooser answers,
 * so once it lands the pick counts twice until this passes, which sends a deployment to a sandbox early, never late.
 */
const RESERVATION_MS = 30_000;

const allocation = schema.sidecarAllocation;
const probe = schema.workflowProbe;

/** Stock's code for a placement refused because the sidecar's active slots were full; it retries the placement. */
const WAITING_FOR_SLOT = "sidecar_reuse_rejected";

/** Stock's probe statuses short of an outcome, as its probe store counts them. */
const ACTIVE_PROBE_STATUSES = [
  "pending",
  "provisioning",
  "probing",
  "releasing",
] as const;

/**
 * A placement refused for room, which stock moves to `replacing` with the code until it tries again: it holds no slot,
 * its cleanup confirmed since nothing was deployed, but takes the next one that frees.
 */
function waitsForSlot(): SQL | undefined {
  return and(
    eq(allocation.status, "replacing"),
    eq(allocation.failureCode, WAITING_FOR_SLOT),
  );
}

/** An allocation holding an active slot, as stock counts a sidecar's room at placement. */
function holdsSlot(): SQL | undefined {
  return or(
    inArray(allocation.status, ["provisioning", "allocated"]),
    and(
      inArray(allocation.status, ["replacing", "releasing", "destroy_failed"]),
      eq(allocation.deploymentCleanupConfirmed, false),
    ),
  );
}

async function countAllocations(
  db: DB["db"],
  where: SQL | undefined,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(allocation)
    .where(where);
  if (row === undefined)
    throw new Error("placement: count query returned no row");
  return row.count;
}

async function activeProbes(
  db: DB["db"],
  provisionerId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(probe)
    .where(
      and(
        eq(probe.provisionerId, provisionerId),
        inArray(probe.status, [...ACTIVE_PROBE_STATUSES]),
      ),
    );
  if (row === undefined)
    throw new Error("placement: count query returned no row");
  return row.count;
}

/** Deployments and probes on the provisioner's sidecar: probes run there too, so both draw from its slots. */
async function activeDeployments(
  db: DB["db"],
  provisionerId: string,
): Promise<number> {
  return (
    (await activeProbes(db, provisionerId)) +
    (await countAllocations(
      db,
      and(eq(allocation.provisionerId, provisionerId), holdsSlot()),
    ))
  );
}

function waitingDeployments(
  db: DB["db"],
  provisionerId: string,
): Promise<number> {
  return countAllocations(
    db,
    and(eq(allocation.provisionerId, provisionerId), waitsForSlot()),
  );
}

/**
 * The local sidecar until it is full, then the first sandbox that matches. Decisions run one at a time, and each local
 * pick holds a slot until its allocation is counted, so placements side by side cannot both take the last one.
 */
export function createPlacementChooser({
  db,
  local,
  maxDeployments,
  now = Date.now,
}: CreatePlacementChooserOpts): SidecarProvisionerChooser {
  let reservations: number[] = [];
  const queue = createSerialQueue();

  async function decide(
    candidates: readonly SidecarProvisioner[],
  ): Promise<SidecarProvisioner> {
    const [first] = candidates;
    if (first === undefined)
      throw new Error("No matching sidecar provisioners are available");
    if (!candidates.includes(local)) return first;
    const sandbox = candidates.find((candidate) => candidate !== local);
    // With nowhere else to go the deployment still goes local, where its placement is retried with backoff until a
    // deployment ends.
    if (sandbox === undefined) return local;
    const at = now();
    reservations = reservations.filter((until) => until > at);
    // A placement waiting for a slot takes the next one that frees, so a new deployment would only queue behind it.
    const taken =
      (await activeDeployments(db, local.id)) +
      (await waitingDeployments(db, local.id)) +
      reservations.length;
    if (taken >= maxDeployments) return sandbox;
    reservations.push(at + RESERVATION_MS);
    return local;
  }

  return function choosePlacement(candidates) {
    return queue.enqueue(() => decide(candidates));
  };
}

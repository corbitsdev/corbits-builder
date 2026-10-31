// One sidecar process on the hub's machine hosts every allocation placed here. The first ensure starts it under the
// identity the hub offered; every later ensure answers with that sidecar, which stock Interchange then deploys into
// over the same connection, up to the active deployments the sidecar advertises in its hello.
import fs from "node:fs/promises";
import path from "node:path";
import type {
  DestroySidecarRequest,
  DestroySidecarResult,
  EnsureSidecarRequest,
  EnsureSidecarResult,
  SidecarProvisioner,
  SidecarProvisionerHost,
} from "@intx/hub-sessions";
import type { AdapterManifest } from "@intx/types";
import { createSerialQueue, settle } from "../lib/serial-queue.ts";
import { errorText } from "./error-text.ts";
import {
  CAPACITY_UNAVAILABLE,
  shortfall,
  type HostCapacity,
} from "./host-capacity.ts";
import type {
  LocalSidecarFence,
  LocalSidecarHold,
  LocalSidecarManifest,
  LocalSidecarManifestStore,
} from "./manifest-store.ts";

const DEFAULT_STOP_TIMEOUT_MS = 25_000;

/** The one local sidecar's SIDECAR_DATA_DIR under the provisioner's data root. */
export function localSidecarDataDir(dataRoot: string): string {
  return path.join(dataRoot, "sidecar");
}

/** How the process ended: its exit code, or the signal that killed it. */
export type LocalSidecarExit = {
  readonly code: number | null;
  readonly signal: string | null;
};

interface LocalSidecarProcess {
  readonly pid: number;
  readonly exited: Promise<LocalSidecarExit>;
  kill(signal: NodeJS.Signals): void;
}

export type SpawnLocalSidecar = (args: {
  readonly manifest: LocalSidecarManifest;
  readonly adapterManifest: AdapterManifest;
}) => LocalSidecarProcess;

type CreateLocalProcessSidecarProvisionerOpts = {
  readonly dataRoot: string;
  readonly spawnSidecar: SpawnLocalSidecar;
  /** Stops a sidecar still running at a recorded pid; resolves whether one was running there. */
  readonly stopStaleSidecar: (
    pid: number,
    timeoutMs: number,
  ) => Promise<boolean>;
  readonly manifests: LocalSidecarManifestStore;
  readonly capacity: HostCapacity;
  /** Operator config, so a respawned sidecar loads the hub's adapters, not the ones it first started with. */
  readonly adapterManifest: AdapterManifest;
  readonly stopTimeoutMs?: number;
  readonly log: (entry: Record<string, unknown>) => void;
};

type LocalSidecarRecords = {
  /** Whether the hub still holds this allocation, at this generation, on the local sidecar. */
  isLive(
    hold: LocalSidecarHold & { readonly sidecarId: string },
  ): Promise<boolean>;
  /** Whether the hub still has work on the sidecar, including copies it waits for the sidecar to remove. */
  hasWork(sidecarId: string): Promise<boolean>;
  /** Those of these allocations and probes stock may still ensure: one it ended is never ensured again. */
  stillOpen(allocationIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Whether the sidecar was minted with the hub's current adapter manifest and may take work again. */
  reusable(sidecarId: string): Promise<boolean>;
};

export interface LocalProcessSidecarProvisioner {
  readonly provisioner: SidecarProvisioner;
  restore(records: LocalSidecarRecords): Promise<void>;
  shutdown(): Promise<void>;
}

type ManagedProcess = {
  readonly handle: LocalSidecarProcess;
  exited: boolean;
};

async function exits(handle: LocalSidecarProcess): Promise<true> {
  await handle.exited;
  return true;
}

async function exitedWithin(
  managed: ManagedProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (managed.exited) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, false);
  });
  try {
    return await Promise.race([exits(managed.handle), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

export function createLocalProcessSidecarProvisioner({
  dataRoot,
  spawnSidecar,
  stopStaleSidecar,
  manifests,
  capacity,
  adapterManifest,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  log,
}: CreateLocalProcessSidecarProvisionerOpts): LocalProcessSidecarProvisioner {
  if (stopTimeoutMs <= 0) {
    throw new Error("Local sidecar stop timeout must be positive");
  }

  const dataDir = localSidecarDataDir(dataRoot);
  const holds = new Map<string, LocalSidecarHold>();
  const fences = new Map<string, Omit<LocalSidecarFence, "allocationId">>();
  let manifest: LocalSidecarManifest | null = null;
  let running: ManagedProcess | null = null;
  const queue = createSerialQueue();
  let shutdownPromise: Promise<void> | null = null;
  let stillOpen: LocalSidecarRecords["stillOpen"] | undefined;
  let host: SidecarProvisionerHost | undefined;
  // Ensure and destroy answer from the sidecar and holds restore brings back, so they wait for it; a failed restore
  // fails them rather than letting an ensure start a second sidecar.
  const restored = Promise.withResolvers<void>();
  void settle(restored.promise);

  // Every operation runs alone: the sidecar starts once, and the holds file is written whole.
  async function serialize<R, T>(
    request: R,
    run: (request: R) => Promise<T>,
  ): Promise<T> {
    if (shutdownPromise !== null) {
      throw new Error("Local sidecar provisioner is shutting down");
    }
    return queue.enqueue(() => run(request));
  }

  async function persistHolds(): Promise<void> {
    await manifests.writeHolds([...holds.values()]);
  }

  function openRecords(): LocalSidecarRecords["stillOpen"] {
    if (stillOpen === undefined)
      throw new Error("Local sidecar provisioner has not been restored");
    return stillOpen;
  }

  // The hub never repeats a destroy, so a fence only memory held would let a late ensure through after a restart.
  async function persistFences(): Promise<void> {
    await manifests.writeFences(
      [...fences].map(([allocationId, fence]) => ({ allocationId, ...fence })),
    );
  }

  // An allocation stock ended is never ensured again, and an ensure for one is refused anyway, so its fence goes.
  async function pruneFences(): Promise<void> {
    const open = await openRecords()([...fences.keys()]);
    for (const allocationId of fences.keys())
      if (!open.has(allocationId)) fences.delete(allocationId);
  }

  // One exit takes down every deployment the sidecar hosts, so each is logged.
  async function trackExit(
    managed: ManagedProcess,
    sidecarId: string,
  ): Promise<void> {
    try {
      const { code, signal } = await managed.handle.exited;
      log({
        level: shutdownPromise === null ? "error" : "info",
        msg: "local_sidecar_exited",
        sidecarId,
        pid: managed.handle.pid,
        code,
        signal,
      });
    } finally {
      managed.exited = true;
    }
  }

  // The recorded pid lets the next hub stop this process if this one dies without shutting it down.
  async function start(current: LocalSidecarManifest): Promise<ManagedProcess> {
    const handle = spawnSidecar({ manifest: current, adapterManifest });
    try {
      await manifests.writePid(handle.pid);
    } catch (error) {
      handle.kill("SIGKILL");
      throw error;
    }
    const managed: ManagedProcess = { handle, exited: false };
    void trackExit(managed, current.sidecarId);
    running = managed;
    return managed;
  }

  /** The running sidecar, started under `request`'s identity when none was minted yet. */
  async function sidecarFor(request: EnsureSidecarRequest): Promise<
    | {
        readonly kind: "running";
        readonly manifest: LocalSidecarManifest;
        readonly process: ManagedProcess;
        readonly minted: boolean;
      }
    | Extract<EnsureSidecarResult, { kind: "rejected" }>
  > {
    if (manifest !== null && running !== null && !running.exited) {
      return { kind: "running", manifest, process: running, minted: false };
    }
    const full = shortfall(await capacity.freeBytes());
    if (full !== undefined) {
      return {
        kind: "rejected",
        code: CAPACITY_UNAVAILABLE,
        message: full,
        retryable: true,
      };
    }
    request.signal?.throwIfAborted();
    const minted = manifest === null;
    const current = manifest ?? {
      sidecarId: request.sidecarId,
      token: request.token,
      hubWebSocketUrl: request.hubWebSocketUrl,
      dataDir,
    };
    try {
      if (minted) {
        await fs.mkdir(dataDir, { recursive: true });
        await manifests.write(current);
        manifest = current;
      }
      const child = await start(current);
      log({
        level: "info",
        msg: minted ? "local_sidecar_started" : "local_sidecar_respawned",
        sidecarId: current.sidecarId,
        pid: child.handle.pid,
      });
      return { kind: "running", manifest: current, process: child, minted };
    } catch (error) {
      // A rejected ensure retires the identity it was offered, so a sidecar minted from it must not outlive it.
      if (minted) {
        manifest = null;
        await manifests.remove();
      }
      return {
        kind: "rejected",
        code: "spawn_failed",
        message: errorText(error),
        retryable: true,
      };
    }
  }

  async function ensureAllocation(
    request: EnsureSidecarRequest,
  ): Promise<EnsureSidecarResult> {
    request.signal?.throwIfAborted();
    const live = holds.get(request.allocationId);
    const fence = fences.get(request.allocationId);
    const newest = live?.generation ?? fence?.generation;
    if (newest !== undefined && newest > request.generation) {
      return {
        kind: "rejected",
        code: "stale_generation",
        message: `Generation ${String(request.generation)} is older than ${String(newest)}`,
        retryable: false,
      };
    }
    // Replacement destroys the old copy at the new generation before ensuring a fresh identity at that same
    // generation. Fence only the identities that destroy named.
    if (
      fence !== undefined &&
      fence.generation === request.generation &&
      fence.sidecarIds.includes(request.sidecarId)
    ) {
      return {
        kind: "rejected",
        code: "generation_destroyed",
        message: `Generation ${String(request.generation)} was already destroyed`,
        retryable: false,
      };
    }
    if (
      live !== undefined &&
      live.generation === request.generation &&
      live.offeredSidecarId !== request.sidecarId
    ) {
      return {
        kind: "rejected",
        code: "sidecar_identity_conflict",
        message: `Generation ${String(request.generation)} already belongs to another sidecar identity`,
        retryable: false,
      };
    }
    // A fence lasts only while stock may ensure its allocation, so one stock ended is refused from its record.
    if (
      live === undefined &&
      !(await openRecords()([request.allocationId])).has(request.allocationId)
    ) {
      return {
        kind: "rejected",
        code: "allocation_ended",
        message: `Allocation ${request.allocationId} has ended`,
        retryable: false,
      };
    }
    const sidecar = await sidecarFor(request);
    if (sidecar.kind === "rejected") return sidecar;
    try {
      holds.set(request.allocationId, {
        allocationId: request.allocationId,
        generation: request.generation,
        offeredSidecarId: request.sidecarId,
      });
      fences.delete(request.allocationId);
      await persistHolds();
      if (fence !== undefined) await persistFences();
      request.signal?.throwIfAborted();
    } catch (error) {
      await abandonEnsure(request.allocationId, { live, fence }, sidecar);
      throw error;
    }
    return {
      kind: "accepted",
      externalRef: String(sidecar.process.handle.pid),
      ...(sidecar.manifest.sidecarId !== request.sidecarId && {
        sidecarId: sidecar.manifest.sidecarId,
      }),
    };
  }

  // Stock retires the identity of an ensure that failed or that it stopped awaiting, so the hold goes back to what it
  // was and a sidecar minted under that identity is stopped and forgotten; the next ensure mints another.
  async function abandonEnsure(
    allocationId: string,
    before: {
      readonly live: LocalSidecarHold | undefined;
      readonly fence: Omit<LocalSidecarFence, "allocationId"> | undefined;
    },
    sidecar: { readonly process: ManagedProcess; readonly minted: boolean },
  ): Promise<void> {
    if (before.live === undefined) holds.delete(allocationId);
    else holds.set(allocationId, before.live);
    if (before.fence !== undefined) fences.set(allocationId, before.fence);
    if (sidecar.minted) {
      await stopProcess(sidecar.process);
      running = null;
      manifest = null;
      await forget();
    }
    try {
      await persistHolds();
      await persistFences();
    } catch (error) {
      log({
        level: "error",
        msg: "local_sidecar_rollback_unpersisted",
        allocationId,
        error: errorText(error),
      });
    }
  }

  // The sidecar outlives every hold, so a copy it hosts is removed by the hub over its connection, which confirms the
  // cleanup. Whether it hosts one follows from the hold, whatever identity the destroy names; an identity offered for
  // an allocation that never joined had nothing deployed under it. A destroy naming the sidecar's own id is always
  // `required`: stock retires an identity whose cleanup a destroy confirms, which would stop every placement on it.
  async function destroyAllocation(
    request: DestroySidecarRequest,
  ): Promise<DestroySidecarResult> {
    const live = holds.get(request.allocationId);
    const fence = fences.get(request.allocationId);
    const newest = live?.generation ?? fence?.generation;
    // A destroy older than the allocation's hold or fence is for a copy a newer generation already replaced.
    const stale = newest !== undefined && newest > request.generation;
    const hosted =
      manifest !== null &&
      !stale &&
      (live !== undefined ||
        (fence?.hosted === true && fence.generation === request.generation));
    if (!stale) {
      const earlier =
        fence?.generation === request.generation ? fence.sidecarIds : [];
      const sidecarIds = [
        ...new Set([
          ...earlier,
          request.sidecarId,
          ...(live === undefined ? [] : [live.offeredSidecarId]),
        ]),
      ];
      fences.set(request.allocationId, {
        generation: request.generation,
        sidecarIds,
        ...(hosted && { hosted }),
      });
      holds.delete(request.allocationId);
      await pruneFences();
      await persistFences();
      if (live !== undefined) await persistHolds();
    }
    return {
      kind: "destroyed",
      cleanup:
        hosted || request.sidecarId === manifest?.sidecarId
          ? "required"
          : "confirmed",
    };
  }

  // A fences file that could not be read loses the fences of allocations still open; an ended one's late ensure is
  // still refused from its record.
  async function restoreFences(): Promise<void> {
    const stored = await manifests.readFences();
    if (stored === null || stored.length === 0) return;
    for (const { allocationId, ...fence } of stored)
      fences.set(allocationId, fence);
    await pruneFences();
    await persistFences();
  }

  async function forgetIdentity(): Promise<void> {
    await manifests.remove();
    await manifests.removePid();
    await manifests.writeHolds([]);
  }

  async function forget(): Promise<void> {
    await forgetIdentity();
    await fs.rm(dataDir, { recursive: true, force: true });
  }

  // A copy whose hold a destroy released is removed only once the sidecar reconnects and the hub undeploys it, so the
  // sidecar comes back for that cleanup too; forgetting it would leave the copy holding a slot for good.
  async function stopStale(): Promise<void> {
    const pid = await manifests.readPid();
    if (pid === null) return;
    if (await stopStaleSidecar(pid, stopTimeoutMs))
      log({ level: "warn", msg: "local_sidecar_stale_stopped", pid });
    await manifests.removePid();
  }

  async function restoreSidecar(records: LocalSidecarRecords): Promise<void> {
    const { isLive, hasWork, reusable } = records;
    stillOpen = records.stillOpen;
    await stopStale();
    await restoreFences();
    const stored = await manifests.read();
    const recorded = await manifests.readHolds();
    if (stored === null) {
      if (recorded.length > 0) await forget();
      return;
    }
    const live: LocalSidecarHold[] = [];
    for (const hold of recorded) {
      if (await isLive({ ...hold, sidecarId: stored.sidecarId }))
        live.push(hold);
    }
    const dropped = recorded.length - live.length;
    // Interchange refuses a sidecar from an older adapter manifest, so its work would sit out the whole
    // disconnect window. Reporting it stopped ends that window and Interchange replaces the work now. The
    // identity is forgotten only once the report lands, so a failed report is retried on the next boot. The
    // replacement mints into the same data dir, so the runs' workspaces and conversation state carry over.
    if (!(await reusable(stored.sidecarId))) {
      if (host === undefined)
        throw new Error("Local sidecar provisioner has not been attached");
      const report = await host.sidecarStopped(stored.sidecarId, {
        endReconnectWindow: true,
      });
      await forgetIdentity();
      log({
        level: "info",
        msg: "local_sidecar_replaced",
        sidecarId: stored.sidecarId,
        dropped,
        report: report.kind,
      });
      return;
    }
    if (live.length === 0 && !(await hasWork(stored.sidecarId))) {
      await forget();
      log({
        level: "info",
        msg: "local_sidecar_removed",
        sidecarId: stored.sidecarId,
        dropped,
      });
      return;
    }
    manifest = stored;
    for (const hold of live) holds.set(hold.allocationId, hold);
    await manifests.writeHolds(live);
    const child = await start(stored);
    log({
      level: "info",
      msg: "local_sidecar_respawned",
      sidecarId: stored.sidecarId,
      pid: child.handle.pid,
      holds: live.length,
      dropped,
    });
  }

  async function stopProcess(managed: ManagedProcess): Promise<void> {
    if (managed.exited) return;
    try {
      managed.handle.kill("SIGTERM");
    } catch (error) {
      if (!managed.exited) throw error;
    }
    if (await exitedWithin(managed, stopTimeoutMs)) return;
    managed.handle.kill("SIGKILL");
    if (!(await exitedWithin(managed, stopTimeoutMs))) {
      throw new Error(
        `Local sidecar process ${String(managed.handle.pid)} did not exit`,
      );
    }
  }

  // The manifest, holds and data dir survive shutdown so the next hub boot can respawn the sidecar.
  async function stopAll(): Promise<void> {
    await queue.idle();
    if (running !== null) await stopProcess(running);
    running = null;
    await manifests.removePid();
  }

  const provisioner: SidecarProvisioner = {
    id: "local-process",
    apiVersion: 2,
    bindingFingerprint: "local-process:v1",
    capabilities: [{ capability: "runtime:posix", state: "available" }],
    attach(offered) {
      host = offered;
    },
    async ensure(request) {
      await restored.promise;
      return serialize(request, ensureAllocation);
    },
    async destroy(request) {
      await restored.promise;
      return serialize(request, destroyAllocation);
    },
  };

  async function restoreOnce(records: LocalSidecarRecords): Promise<void> {
    try {
      await serialize(records, restoreSidecar);
      restored.resolve();
    } catch (error) {
      restored.reject(error);
      throw error;
    }
  }

  return {
    provisioner,
    restore: restoreOnce,
    shutdown() {
      shutdownPromise ??= stopAll();
      return shutdownPromise;
    },
  };
}

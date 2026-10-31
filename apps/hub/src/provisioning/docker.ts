// Containers here are not a multiuser isolation boundary.
import { randomBytes } from "node:crypto";
import { type } from "arktype";
import type {
  DestroySidecarRequest,
  DestroySidecarResult,
  EnsureSidecarRequest,
  EnsureSidecarResult,
  SidecarProvisioner,
} from "@intx/hub-sessions";
import type { AdapterManifest } from "@intx/types";
import { settle } from "../lib/serial-queue.ts";
import {
  DockerEngineError,
  isThisMachine,
  type DockerEngine,
} from "./docker-engine.ts";

export { connectDocker } from "./docker-engine.ts";

const LABEL = {
  hub: "corbits-builder.hub",
  allocation: "corbits-builder.allocation",
  generation: "corbits-builder.generation",
  sidecar: "corbits-builder.sidecar",
} as const;
const DATA_DIR = "/data";
const MiB = 1024 ** 2;
type DockerLimits = {
  readonly memoryBytes: number;
  readonly pids: number;
  readonly nanoCpus: number;
};
export const defaultDockerLimits: DockerLimits = {
  memoryBytes: 2048 * MiB,
  pids: 1024,
  nanoCpus: 2_000_000_000,
};

const Container = type({
  Id: "string",
  Labels: {
    [LABEL.hub]: "string",
    [LABEL.allocation]: "string",
    [LABEL.generation]: "string.integer.parse",
    [LABEL.sidecar]: "string",
  },
});
type Container = typeof Container.infer;
const Listed = type("unknown[]");
const Created = type({ Id: "string" });
const Info = type({ MemTotal: "number" });

type CreateDockerSidecarProvisionerOpts = {
  readonly engine: DockerEngine;
  /** Labels every container, so hubs sharing a daemon never touch each other's sidecars. */
  readonly hubId: string;
  readonly limits?: DockerLimits;
  /** The daemon's own `ID` from `/info`, so repointing the hub at another daemon changes the binding. */
  readonly daemonId: string;
  /** Runs the stock sidecar as its command. */
  readonly image: string;
  /** The hub's adapter manifest at the paths the image holds its modules. */
  readonly adapterManifest: AdapterManifest;
  /** Where containers reach the hub, for a daemon on another machine; unset, the hub's own address with loopback mapped to the Docker host. */
  readonly hubWebSocketUrl?: string;
};

type Fence = {
  readonly generation: number;
  readonly destroyedSidecarId?: string;
};

function isDestroyedBy(
  container: Container,
  request: DestroySidecarRequest,
): boolean {
  const generation = container.Labels[LABEL.generation];
  return (
    generation < request.generation ||
    (generation === request.generation &&
      container.Labels[LABEL.sidecar] === request.sidecarId)
  );
}

// A container cannot reach the hub's loopback; Docker maps host.docker.internal to the host.
function hubUrlFromContainer(url: string): string {
  const parsed = new URL(url);
  if (isThisMachine(parsed.hostname)) parsed.hostname = "host.docker.internal";
  return parsed.href;
}

/** Containers missing one of our labels are not ours, so they are left out. */
async function listContainers(
  engine: DockerEngine,
  labels: readonly string[],
  signal?: AbortSignal,
): Promise<Container[]> {
  const filters = encodeURIComponent(JSON.stringify({ label: labels }));
  const listed = Listed.assert(
    await engine.request(
      "GET",
      `/containers/json?all=true&filters=${filters}`,
      { signal },
    ),
  );
  return listed
    .map((value) => Container(value))
    .filter((parsed): parsed is Container => !(parsed instanceof type.errors));
}

async function removeContainer(
  engine: DockerEngine,
  id: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await engine.request("DELETE", `/containers/${id}?force=true&v=true`, {
      signal,
    });
  } catch (error) {
    if (!(error instanceof DockerEngineError) || error.status !== 404)
      throw error;
  }
}

/**
 * One container per sidecar, with its own anonymous data volume, labelled with
 * this hub, the allocation, the generation and the sidecar id.
 */
export function createDockerSidecarProvisioner({
  engine,
  hubId,
  daemonId,
  image,
  adapterManifest,
  hubWebSocketUrl,
  limits = defaultDockerLimits,
}: CreateDockerSidecarProvisionerOpts): SidecarProvisioner {
  for (const value of [limits.memoryBytes, limits.pids, limits.nanoCpus])
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Docker limits must be positive safe integers");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(hubId))
    throw new Error("Docker hub identity is invalid");
  const fences = new Map<string, Fence>();
  const queues = new Map<string, Promise<unknown>>();
  /** Containers being created, which a listing may not show yet. */
  let starting = 0;

  async function list(
    allocationId: string,
    signal?: AbortSignal,
  ): Promise<Container[]> {
    return listContainers(
      engine,
      [`${LABEL.hub}=${hubId}`, `${LABEL.allocation}=${allocationId}`],
      signal,
    );
  }

  /** The daemon's memory less what this hub's containers hold; a stopped one counts until the hub destroys it. */
  async function freeBytes(signal?: AbortSignal): Promise<number> {
    const { MemTotal } = Info.assert(
      await engine.request("GET", "/info", { signal }),
    );
    const held = await listContainers(
      engine,
      [`${LABEL.hub}=${hubId}`],
      signal,
    );
    return MemTotal - held.length * limits.memoryBytes;
  }

  async function create(request: EnsureSidecarRequest): Promise<string> {
    const env = {
      HUB_WS_URL:
        hubWebSocketUrl ?? hubUrlFromContainer(request.hubWebSocketUrl),
      SIDECAR_ID: request.sidecarId,
      SIDECAR_TOKEN: request.token,
      SIDECAR_DATA_DIR: DATA_DIR,
      SIDECAR_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      SIDECAR_ADAPTER_MANIFEST: JSON.stringify(adapterManifest),
      HOME: DATA_DIR,
      TMPDIR: "/tmp",
    };
    const body = {
      Image: image,
      Env: Object.entries(env).map(([name, value]) => `${name}=${value}`),
      Labels: {
        [LABEL.hub]: hubId,
        [LABEL.allocation]: request.allocationId,
        [LABEL.generation]: String(request.generation),
        [LABEL.sidecar]: request.sidecarId,
      },
      HostConfig: {
        // An init process forwards the stop signal to the sidecar.
        Init: true,
        ReadonlyRootfs: true,
        Memory: limits.memoryBytes,
        MemorySwap: limits.memoryBytes,
        PidsLimit: limits.pids,
        NanoCpus: limits.nanoCpus,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges"],
        Tmpfs: { "/tmp": "" },
        Mounts: [{ Type: "volume", Target: DATA_DIR }],
        ...(hubWebSocketUrl === undefined && {
          ExtraHosts: ["host.docker.internal:host-gateway"],
        }),
      },
    };
    const { signal } = request;
    const { Id } = Created.assert(
      await engine.request(
        "POST",
        `/containers/create?name=sb-${hubId}-${request.sidecarId}`,
        {
          body,
          signal,
        },
      ),
    );
    try {
      await engine.request("POST", `/containers/${Id}/start`, { signal });
    } catch (error) {
      await removeContainer(engine, Id);
      throw error;
    }
    return Id;
  }

  async function runAfter<T>(
    previous: Promise<unknown> | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    await settle(previous);
    return run();
  }

  async function forgetWhenSettled(
    allocationId: string,
    pending: Promise<unknown>,
  ): Promise<void> {
    await settle(pending);
    if (queues.get(allocationId) === pending) queues.delete(allocationId);
  }

  // A late ensure the hub stopped waiting for still finishes before the
  // destroy that fences it, so the destroy removes what it created.
  function serialize<T>(
    allocationId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const pending = runAfter(queues.get(allocationId), run);
    queues.set(allocationId, pending);
    void forgetWhenSettled(allocationId, pending);
    return pending;
  }

  async function ensureSidecar(
    request: EnsureSidecarRequest,
  ): Promise<EnsureSidecarResult> {
    request.signal?.throwIfAborted();
    const fence = fences.get(request.allocationId);
    const containers = await list(request.allocationId, request.signal);
    const observed = Math.max(
      fence?.generation ?? 0,
      ...containers.map((container) => container.Labels[LABEL.generation]),
    );
    if (request.generation < observed) {
      return {
        kind: "rejected",
        code: "stale_generation",
        message: `Generation ${String(request.generation)} is older than ${String(observed)}`,
        retryable: false,
      };
    }
    if (
      request.generation === fence?.generation &&
      request.sidecarId === fence.destroyedSidecarId
    ) {
      return {
        kind: "rejected",
        code: "sidecar_destroyed",
        message: `Sidecar ${request.sidecarId} was destroyed`,
        retryable: false,
      };
    }
    const existing = containers.find(
      (container) =>
        container.Labels[LABEL.generation] === request.generation &&
        container.Labels[LABEL.sidecar] === request.sidecarId,
    );
    if (existing !== undefined)
      return { kind: "accepted", externalRef: existing.Id };

    const free = await freeBytes(request.signal);
    // Decided and counted with no await between, so ensures running side by side each see the others.
    const needed = (starting + 1) * limits.memoryBytes;
    if (free < needed) {
      return {
        kind: "rejected",
        code: "capacity_unavailable",
        message: `${String(Math.floor(free / MiB))} MiB free, ${String(needed / MiB)} MiB needed`,
        retryable: true,
      };
    }
    starting += 1;
    try {
      if (fence === undefined || request.generation > fence.generation) {
        fences.set(request.allocationId, { generation: request.generation });
      }
      return { kind: "accepted", externalRef: await create(request) };
    } finally {
      starting -= 1;
    }
  }

  async function destroySidecar(
    request: DestroySidecarRequest,
  ): Promise<DestroySidecarResult> {
    const fence = fences.get(request.allocationId);
    if (fence === undefined || request.generation >= fence.generation) {
      fences.set(request.allocationId, {
        generation: request.generation,
        destroyedSidecarId: request.sidecarId,
      });
    }
    for (const container of (
      await list(request.allocationId, request.signal)
    ).filter((container) => isDestroyedBy(container, request))) {
      await removeContainer(engine, container.Id, request.signal);
    }
    const remaining = (await list(request.allocationId, request.signal)).filter(
      (container) => isDestroyedBy(container, request),
    );
    if (remaining.length > 0) {
      throw new Error(
        `Sidecar containers for ${request.allocationId} are still present`,
      );
    }
    return { kind: "destroyed", cleanup: "confirmed" };
  }

  return {
    id: "docker",
    apiVersion: 2,
    // The image is a launch setting: containers are found by label whatever image they run.
    bindingFingerprint: `docker:v1:${daemonId}:${hubId}:${limits.memoryBytes}:${limits.pids}:${limits.nanoCpus}`,
    capabilities: [
      { capability: "isolation:workload", state: "blocked" },
      { capability: "network:outbound", state: "available" },
      { capability: "runtime:posix", state: "available" },
    ],
    ensure(request) {
      return serialize(request.allocationId, () => ensureSidecar(request));
    },
    destroy(request) {
      return serialize(request.allocationId, () => destroySidecar(request));
    },
  };
}

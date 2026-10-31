import { resolve } from "node:path";
import { type } from "arktype";
import type { SidecarProvisioner } from "@intx/hub-sessions";
import {
  createSidecarAllocationStore,
  createWorkflowRunDispatchStore,
  createWorkflowRunLaunchSpecStore,
  type DB,
  type PrincipalKeyStore,
} from "@intx/db";
import {
  attachSidecarProvisioners,
  createParkedRunClassifier,
  createReconciliationScheduler,
  createSidecarAllocationReconciler,
  createSidecarPluginRegistry,
  createWorkflowAllocationService,
  createWorkflowDispatchProjection,
  createWorkflowDispatchService,
  createWorkflowLifecycleService,
  createWorkflowRunReader,
  recoverSenderDeploy,
  type AgentRepoStore,
  type createSessionService,
  type createSidecarRouter,
  type WorkflowHistoryReceiveTracker,
} from "@intx/hub-sessions";
import {
  LifecycleDuration,
  parseAdapterManifestEnv,
  lifecycleDurationMs,
  type CredentialCipher,
  type ResolvedWorkflowLifecyclePolicy,
} from "@intx/types";
import { getLogger } from "@intx/log";
import {
  connectDocker,
  createDockerSidecarProvisioner,
  defaultDockerLimits,
} from "./docker.ts";
import { localSidecarDataRoot } from "../sidecar/data-root.ts";
import { createHostCapacity } from "../sidecar/host-capacity.ts";
import {
  createLocalProcessSidecarProvisioner,
  localSidecarDataDir,
} from "../sidecar/local-provisioner.ts";
import { createLocalSidecarManifestStore } from "../sidecar/manifest-store.ts";
import { createPlacementChooser } from "../sidecar/placement.ts";
import { restoreLocalSidecars } from "../sidecar/restore.ts";
import {
  childProcessEnv,
  createSpawnLocalSidecar,
  stopStaleLocalSidecar,
} from "../sidecar/spawn.ts";

const log = getLogger(["corbits-builder", "workflow-services"]);
const Daemon = type({ ID: "string > 0" });
const Image = type({ Id: "string > 0" });
const ROOT = resolve(import.meta.dir, "../../../..");
const INTERCHANGE_DIR = resolve(ROOT, "vendor/interchange");

function sidecarLog(entry: Record<string, unknown>): void {
  const msg = String(entry.msg ?? "local_sidecar");
  if (entry.level === "error") log.error(msg, entry);
  else if (entry.level === "warn") log.warn(msg, entry);
  else log.info(msg, entry);
}

export async function createWorkflowServices(options: {
  db: DB["db"];
  router: ReturnType<typeof createSidecarRouter>;
  sessionService: ReturnType<typeof createSessionService>;
  repos: AgentRepoStore;
  historyReceives: WorkflowHistoryReceiveTracker;
  cipher: CredentialCipher;
  principalKeyStore: PrincipalKeyStore;
  environment: Record<string, string | undefined>;
  publicURL: URL;
  hubId: string;
}) {
  const { db, router, repos, historyReceives, environment } = options;
  const allocationStore = createSidecarAllocationStore(db, {
    getSidecarInventory: router.getSidecarInventory,
  });
  const hubWebSocketUrl = new URL(
    "/api/sidecars/ws",
    options.publicURL,
  ).href.replace(/^http/, "ws");
  const integer = (key: string, fallback: number) => {
    const raw = environment[key];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${key} must be a positive safe integer`);
    return value;
  };
  const adapterManifest = parseAdapterManifestEnv(
    environment["SIDECAR_ADAPTER_MANIFEST"],
  ) ?? [
    {
      provider: "openai-responses",
      specifier: import.meta.resolve("@corbits/openai-responses"),
      export: "createOpenAIResponsesAdapter",
    },
    {
      provider: "openai-compatible",
      specifier: new URL("../inference/openai-compatible.ts", import.meta.url)
        .href,
      export: "createOpenAICompatibleAdapter",
    },
    {
      provider: "codex",
      specifier: new URL("../inference/codex-adapter.ts", import.meta.url).href,
      export: "createCodexResponsesAdapter",
    },
    {
      provider: "xai",
      specifier: import.meta.resolve("@corbits/xai-provider"),
      export: "createXaiResponsesAdapter",
    },
  ];
  const credentialEncryptionKey = environment["CREDENTIAL_ENCRYPTION_KEY"];
  if (!credentialEncryptionKey)
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required");
  const maxActiveDeployments = integer("SIDECAR_LOCAL_MAX_ACTIVE", 16);
  const dataRoot = localSidecarDataRoot(
    environment["HUB_DATA_DIR"] ?? "data/hub",
  );
  const local = createLocalProcessSidecarProvisioner({
    dataRoot,
    spawnSidecar: createSpawnLocalSidecar({
      interchangeDir: INTERCHANGE_DIR,
      credentialEncryptionKey,
      maxActiveDeployments,
      processEnv: childProcessEnv(environment),
    }),
    stopStaleSidecar: stopStaleLocalSidecar,
    manifests: createLocalSidecarManifestStore({
      dataRoot,
      cipher: options.cipher,
      log: sidecarLog,
    }),
    capacity: createHostCapacity({
      cgroupRoot: "/sys/fs/cgroup",
      meminfo: "/proc/meminfo",
    }),
    adapterManifest,
    log: sidecarLog,
  });
  const provisioners: SidecarProvisioner[] = [local.provisioner];
  const imageName = environment["SIDECAR_IMAGE"];
  if (imageName) {
    const engine = connectDocker(
      environment["SIDECAR_DOCKER_HOST"] ?? "unix:///var/run/docker.sock",
    );
    const daemon = Daemon.assert(await engine.request("GET", "/info"));
    const image = Image.assert(
      await engine.request(
        "GET",
        `/images/${encodeURIComponent(imageName)}/json`,
      ),
    );
    provisioners.push(
      createDockerSidecarProvisioner({
        engine,
        hubId: environment["SIDECAR_DOCKER_HUB_ID"] ?? options.hubId,
        daemonId: daemon.ID,
        image: image.Id,
        adapterManifest,
        limits: {
          memoryBytes: integer(
            "SIDECAR_MEMORY_BYTES",
            defaultDockerLimits.memoryBytes,
          ),
          pids: integer("SIDECAR_PIDS", defaultDockerLimits.pids),
          nanoCpus: integer("SIDECAR_NANO_CPUS", defaultDockerLimits.nanoCpus),
        },
        ...(environment["SIDECAR_HUB_WS_URL"]
          ? { hubWebSocketUrl: environment["SIDECAR_HUB_WS_URL"] }
          : {}),
      }),
    );
  }
  const plugins = createSidecarPluginRegistry({
    provisioners,
    chooser: createPlacementChooser({
      db,
      local: local.provisioner,
      maxDeployments: maxActiveDeployments,
    }),
  });
  const duration = (key: string, fallback: string) =>
    LifecycleDuration.assert(environment[key] ?? fallback);
  const defaultLifecyclePolicy: ResolvedWorkflowLifecyclePolicy = {
    maxLifetime: duration("WORKFLOW_DEFAULT_MAX_LIFETIME", "7d"),
    maxDisconnected: duration("WORKFLOW_DEFAULT_MAX_DISCONNECTED", "15m"),
    capacityRetention: {
      completed: duration("WORKFLOW_DEFAULT_RETENTION_COMPLETED", "30m"),
      failed: duration("WORKFLOW_DEFAULT_RETENTION_FAILED", "24h"),
      cancelled: duration("WORKFLOW_DEFAULT_RETENTION_CANCELLED", "1h"),
    },
  };
  if (
    !lifecycleDurationMs(defaultLifecyclePolicy.maxLifetime) ||
    !lifecycleDurationMs(defaultLifecyclePolicy.maxDisconnected)
  )
    throw new Error(
      "Workflow lifetime and disconnect windows must be positive",
    );
  const allocation = createWorkflowAllocationService({
    db,
    deploymentPlugins: plugins,
    probePlugins: plugins,
    preparedDeployer: options.sessionService,
    credentialCipher: options.cipher,
    allocationRouter: router,
    hubWebSocketUrl,
    defaultLifecyclePolicy,
    adapterManifest,
  });
  const reader = createWorkflowRunReader(repos.repoStore);
  const launches = createWorkflowRunLaunchSpecStore(db);
  const addressForAnchor = async (id: string) => {
    const row = await db.query.workflowRun.findFirst({
      where: (run, { eq }) => eq(run.id, id),
      columns: { address: true },
    });
    return row?.address ?? null;
  };
  const lifecycle = createWorkflowLifecycleService({
    db,
    retentionRouter: router,
    runReader: reader,
    historyReceives,
    sendControl: (target, command, timeout) =>
      router.sendWorkflowControl(target, command, timeout),
  });
  const projection = createWorkflowDispatchProjection({
    db,
    repoStore: repos.repoStore,
  });
  const dispatch = createWorkflowDispatchService({
    dispatchStore: createWorkflowRunDispatchStore(db),
    allocationStore,
    router,
    resolveAnchorAddress: addressForAnchor,
  });
  const reconciliation = createSidecarAllocationReconciler({
    allocationStore,
    plugins,
    router,
    hubWebSocketUrl,
    adapterManifest,
    classifyParkedRun: createParkedRunClassifier({
      runReader: reader,
      addressForAnchor,
      projectionForAnchor: async (id) =>
        (await launches.get(id))?.frozenApprovalBundle.projection ?? null,
    }),
    onInitializationRecovery: (row, context) =>
      recoverSenderDeploy({
        db,
        sidecarRouter: router,
        allocation: row,
        reconciliation: context,
      }),
    onReady: async (row, context) => {
      await allocation.deployReadyAllocation(row, context);
      context.signal.throwIfAborted();
      await dispatch.requeueForReadyAllocation(row.anchorRunId);
    },
  });
  await allocation.initialize?.();
  await reconciliation.initialize();
  attachSidecarProvisioners({
    provisioners,
    retireProvisionerSidecar: allocationStore.retireProvisionerSidecar,
    isConnected: router.holdsAllocatedBinding,
  });
  await restoreLocalSidecars(db, local, adapterManifest);
  const pending = new Set<Promise<unknown>>();
  const track = <T>(run: () => Promise<T>): Promise<T> => {
    const task = Promise.resolve().then(run);
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  };
  const report = (run: () => Promise<unknown>) =>
    track(run)
      .then(() => undefined)
      .catch(() => {
        log.error("Native workflow connection reconciliation failed");
      });
  const unsubscribers = [
    router.events.on("sidecar.disconnect", ({ allocated }) =>
      report(async () => {
        await Promise.all(
          allocated.map((target) => reconciliation.handleDisconnect(target)),
        );
      }),
    ),
    router.events.on("sidecar.allocated.connected", (target) =>
      report(() => reconciliation.handleConnected(target)),
    ),
    router.events.on("deployment.stopped", (target) =>
      report(() => reconciliation.handleConnected(target)),
    ),
    router.events.on("mail.inbound.acknowledged", ({ messageId, allocated }) =>
      allocated === undefined
        ? undefined
        : report(() => dispatch.acknowledge({ ...allocated, messageId })),
    ),
  ];
  const poll = (
    name: string,
    run: () => Promise<boolean>,
    concurrency?: number,
    intervalMs?: number,
  ) =>
    createReconciliationScheduler({
      name,
      reconcileNext: () => track(run),
      ...(concurrency === undefined ? {} : { concurrency }),
      ...(intervalMs === undefined ? {} : { intervalMs }),
    });
  const schedulers = [
    poll("Sidecar allocation", () => reconciliation.reconcileNext()),
    poll(
      "Workflow probe cleanup",
      async () => {
        await allocation.reconcileReleasingProbes?.();
        return false;
      },
      1,
      30_000,
    ),
    poll("Workflow lifecycle", () => lifecycle.reconcileNext()),
    poll("Workflow dispatch projection", async () => {
      await projection.reconcileNext();
      return false;
    }),
    poll(
      "Workflow dispatch",
      async () => {
        await dispatch.reconcileUntilIdle();
        return false;
      },
      1,
    ),
    poll(
      "Sidecar connection repair",
      async () => {
        await reconciliation.repairUnscheduledConnections();
        return false;
      },
      1,
      30_000,
    ),
  ];
  return {
    services: {
      workflowAllocationService: allocation,
      workflowDispatchService: dispatch,
      workflowLifecycleService: lifecycle,
    },
    configured: true as const,
    // The sidecar resolves its data dir from its own working directory.
    localSidecarDataDir: resolve(
      INTERCHANGE_DIR,
      localSidecarDataDir(dataRoot),
    ),
    start() {
      for (const scheduler of schedulers) scheduler.start();
    },
    stop() {
      for (const scheduler of schedulers) scheduler.stop();
      for (const off of unsubscribers) off();
    },
    async drain() {
      await Promise.allSettled(pending);
      await local.shutdown();
    },
  };
}

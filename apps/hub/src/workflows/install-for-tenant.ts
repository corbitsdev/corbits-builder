import { and, eq } from "drizzle-orm";
import { type } from "arktype";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listVisibleOfferings, listVisibleProviders, type DB } from "@intx/db";
import {
  asset,
  credential,
  model,
  modelOffering,
  tenant,
} from "@intx/db/schema";
import {
  AssetServiceError,
  DEFAULT_ASSET_REF,
  TARBALLS_PREFIX,
  type AssetService,
} from "@intx/hub-sessions";
import {
  InstalledWorkflows,
  INSTALLED_WORKFLOWS_KEY,
} from "@corbits-builder/schemas/installed-workflows";
import type { RoleBinding } from "@corbits-builder/schemas/models";
import type { WorkflowRole } from "@corbits-builder/schemas/installed-workflows";
import {
  modelProvider,
  providerOfRow,
  workflowBindings,
} from "../config/models.ts";
import {
  isOAuthModelPlugin,
  offeringQuirks,
} from "../inference/oauth-login-quirks.ts";
import { projectModelChoice } from "../projects/model-choice.ts";
import { ProjectError } from "../projects/errors.ts";
import { buildWorkflowPackages } from "./build-packages.ts";
import type { Actor } from "../lib/actor.ts";

const PACKAGE_VERSION = "1.0.0";
const HUB = { kind: "hub" } as const;

type InstallForTenantPorts = {
  db: DB["db"];
  assets: Pick<
    AssetService,
    "createAsset" | "populateAsset" | "listAssetBlobs"
  >;
};

type Bindings = Record<WorkflowRole, RoleBinding>;
type Source = Pick<RoleBinding, "provider" | "model">;

// One build per set of role bindings: the binding is inlined, so it is part of the bundle.
const packages = new Map<
  string,
  Promise<
    {
      assetName: string;
      filename: string;
      packageName: string;
      version: string;
      entry: string;
      bytes: Uint8Array;
    }[]
  >
>();

export function startFailed(): ProjectError {
  return new ProjectError(409, "coordinator_start_failed", {
    message: "The coordinator did not become ready.",
  });
}

function providerMissing(source: Source): ProjectError {
  return new ProjectError(409, "inference_provider_missing", {
    message: `Connect a ${modelProvider(source.provider)?.label ?? source.provider} model provider before starting a project.`,
  });
}

function minted(prefix: "mdl_" | "mof_"): string {
  return (
    prefix +
    Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")
  );
}

function installedFrom(config: unknown): InstalledWorkflows | null {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return null;
  if (!(INSTALLED_WORKFLOWS_KEY in config)) return null;
  const parsed = InstalledWorkflows(config[INSTALLED_WORKFLOWS_KEY]);
  return parsed instanceof type.errors ? null : parsed;
}

function builtPackages(bindings: Bindings) {
  const key = JSON.stringify(bindings);
  const cached = packages.get(key);
  if (cached) return cached;
  const building = (async () => {
    const directory = await mkdtemp(join(tmpdir(), "sb-hub-packages-"));
    try {
      const manifest = await buildWorkflowPackages(
        directory,
        PACKAGE_VERSION,
        bindings,
      );
      return await Promise.all(
        manifest.map(async (item) => ({
          ...item,
          bytes: new Uint8Array(
            await Bun.file(join(directory, item.file)).arrayBuffer(),
          ),
        })),
      );
    } catch (error) {
      packages.delete(key);
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  })();
  packages.set(key, building);
  return building;
}

type VisibleOffering = Awaited<ReturnType<typeof listVisibleOfferings>>[number];

async function credentialMetadata(db: DB["db"], credentialId: string | null) {
  if (!credentialId) return null;
  const [row] = await db
    .select({ metadata: credential.metadata })
    .from(credential)
    .where(eq(credential.id, credentialId));
  const metadata = row?.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : null;
}

type ProviderRow = VisibleOffering["provider"];

// What an offering must carry for its adapter: for a login, the host identity and the account the
// login was made for; otherwise its provider entry's quirks. Null when the adapter takes none.
async function wantedQuirks(db: DB["db"], row: ProviderRow) {
  if (isOAuthModelPlugin(row.plugin))
    return offeringQuirks(
      row.plugin,
      await credentialMetadata(db, row.credentialId),
    );
  return providerOfRow(row)?.quirks ?? null;
}

function wantedCapabilities(row: ProviderRow): readonly string[] {
  return providerOfRow(row)?.capabilities ?? [];
}

function declaresCapabilities(
  offering: VisibleOffering["offering"],
  wanted: readonly string[],
) {
  return wanted.every((capability) =>
    offering.capabilities.some((have) => have === capability),
  );
}

// The pinned offering must serve the role's declared pair or the operator-approved grant
// `inference.source:<provider>:<model>` never matches at deploy time.
async function servesSource(
  db: DB["db"],
  row: VisibleOffering,
  source: Source,
): Promise<boolean> {
  if (
    row.offering.disabled ||
    row.model.disabled ||
    row.provider.disabled ||
    providerOfRow(row.provider)?.id !== source.provider ||
    row.model.canonicalName !== source.model
  )
    return false;
  const quirks = await wantedQuirks(db, row.provider);
  return (
    declaresCapabilities(row.offering, wantedCapabilities(row.provider)) &&
    (quirks === null ||
      JSON.stringify(row.offering.quirks) === JSON.stringify(quirks))
  );
}

/** The visible catalog offering a role bound to `source` runs on, once one is minted. */
export async function servingOffering(
  db: DB["db"],
  tenantId: string,
  source: Source,
) {
  for (const row of await listVisibleOfferings(db, tenantId))
    if (await servesSource(db, row, source)) return row.offering;
  return undefined;
}

async function offeringId(
  db: DB["db"],
  tenantId: string,
  source: Source,
): Promise<string> {
  const serving = await servingOffering(db, tenantId, source);
  if (serving) return serving.id;
  // A project is a child tenant; its provider lives up the tree where the
  // person connected it. The model and offering are minted beside that
  // provider so every descendant resolves them.
  const visible = (await listVisibleProviders(db, tenantId)).find(
    (entry) =>
      providerOfRow(entry.row)?.id === source.provider && !entry.row.disabled,
  );
  if (!visible) throw providerMissing(source);
  const providerId = visible.row.id;
  const quirks = await wantedQuirks(db, visible.row);
  const capabilities = [...wantedCapabilities(visible.row)];
  tenantId = visible.origin.tenantId;
  const [named] = await db
    .select({ id: model.id })
    .from(model)
    .where(
      and(
        eq(model.tenantId, tenantId),
        eq(model.canonicalName, source.model),
        eq(model.disabled, false),
      ),
    );
  const modelId =
    named?.id ??
    (
      await db
        .insert(model)
        .values({ id: minted("mdl_"), tenantId, canonicalName: source.model })
        .onConflictDoNothing()
        .returning({ id: model.id })
    )[0]?.id;
  const resolvedModelId =
    modelId ??
    (
      await db
        .select({ id: model.id })
        .from(model)
        .where(
          and(
            eq(model.tenantId, tenantId),
            eq(model.canonicalName, source.model),
          ),
        )
    )[0]?.id;
  if (!resolvedModelId) throw startFailed();
  const [created] = await db
    .insert(modelOffering)
    .values({
      id: minted("mof_"),
      tenantId,
      modelId: resolvedModelId,
      providerId,
      priority: 0,
      quirks,
      capabilities,
    })
    .onConflictDoNothing()
    .returning({ id: modelOffering.id });
  if (created) return created.id;
  const [raced] = await db
    .select({ id: modelOffering.id })
    .from(modelOffering)
    .where(
      and(
        eq(modelOffering.tenantId, tenantId),
        eq(modelOffering.modelId, resolvedModelId),
        eq(modelOffering.providerId, providerId),
      ),
    );
  if (!raced) throw startFailed();
  // The offering already existed for an earlier login or before its capabilities were declared;
  // it now names this one's account and carries the provider's capabilities.
  await db
    .update(modelOffering)
    .set(quirks === null ? { capabilities } : { quirks, capabilities })
    .where(eq(modelOffering.id, raced.id));
  return raced.id;
}

type Built = Awaited<ReturnType<typeof builtPackages>>;
const ROLES = [
  "coordinator",
  "writer",
  "reviewer",
  "coder",
  "designer",
  "presenter",
] as const;

/** A stored descriptor is current only while it pins this build's packages and, for each role, an offering serving its source. */
async function isCurrent(
  db: DB["db"],
  tenantId: string,
  installed: InstalledWorkflows,
  built: Built,
  bindings: Bindings,
) {
  const pins = new Set(
    built.map((item) => item.packageName + "@" + item.version),
  );
  if (
    ![...ROLES, "coderAnyPackage" as const].every((key) => {
      const entry = installed[key];
      return entry !== undefined && pins.has(entry.pin);
    })
  )
    return false;
  const visible = await listVisibleOfferings(db, tenantId);
  for (const role of ROLES) {
    const entry = installed[role];
    if (!entry) return false;
    const row = visible.find(
      (candidate) => candidate.offering.id === entry.defaultSourceOfferingId,
    );
    if (!row || !(await servesSource(db, row, bindings[role]))) return false;
  }
  return true;
}

async function registryAsset(
  ports: InstallForTenantPorts,
  actor: Actor,
  name: string,
): Promise<string> {
  const [found] = await ports.db
    .select({ id: asset.id })
    .from(asset)
    .where(
      and(
        eq(asset.tenantId, actor.tenantId),
        eq(asset.kind, "package-registry"),
        eq(asset.name, name),
      ),
    );
  if (found) return found.id;
  try {
    const created = await ports.assets.createAsset({
      tenantId: actor.tenantId,
      kind: "package-registry",
      name,
      creatorPrincipalId: actor.principalId,
    });
    return created.id;
  } catch (error) {
    if (
      !(error instanceof AssetServiceError) ||
      error.reason !== "duplicate_asset"
    )
      throw error;
    const [raced] = await ports.db
      .select({ id: asset.id })
      .from(asset)
      .where(
        and(
          eq(asset.tenantId, actor.tenantId),
          eq(asset.kind, "package-registry"),
          eq(asset.name, name),
        ),
      );
    if (!raced) throw error;
    return raced.id;
  }
}

async function tarballNames(
  assets: InstallForTenantPorts["assets"],
  assetId: string,
) {
  try {
    return await assets.listAssetBlobs({ assetId, dir: "tarballs" });
  } catch (error) {
    if (error instanceof AssetServiceError && error.reason === "not_found")
      return [];
    throw error;
  }
}

/** Installs the role packages a project runs, on the model bindings it kept when it started. */
export async function installForTenant(
  ports: InstallForTenantPorts,
  actor: Actor,
  projectId: string,
): Promise<InstalledWorkflows> {
  const [row] = await ports.db
    .select({ config: tenant.config })
    .from(tenant)
    .where(eq(tenant.id, actor.tenantId));
  const bindings = workflowBindings(
    await projectModelChoice(ports.db, actor, projectId),
  );
  const built = await builtPackages(bindings);
  const existing = installedFrom(row?.config);
  if (
    existing &&
    (await isCurrent(ports.db, actor.tenantId, existing, built, bindings))
  )
    return existing;
  const offerings = new Map<string, string>();
  for (const role of ROLES) {
    const key = bindings[role].provider + "\u0000" + bindings[role].model;
    if (!offerings.has(key))
      offerings.set(
        key,
        await offeringId(ports.db, actor.tenantId, bindings[role]),
      );
  }
  const offeringFor = (role: WorkflowRole) =>
    offerings.get(bindings[role].provider + "\u0000" + bindings[role].model)!;
  const published: { assetId: string; entry: string; pin: string }[] = [];
  for (const item of built) {
    const assetId = await registryAsset(ports, actor, item.assetName);
    const names = await tarballNames(ports.assets, assetId);
    // The filename's version is the bundle's hash, so a stored tarball of that name holds this
    // bundle; its gzip bytes differ on every rebuild and are not compared.
    if (!names.includes(item.filename)) {
      await ports.assets.populateAsset({
        assetId,
        ref: DEFAULT_ASSET_REF,
        principal: HUB,
        tree: {
          files: { [TARBALLS_PREFIX + item.filename]: item.bytes },
          message: item.filename,
        },
      });
    }
    published.push({
      assetId,
      entry: item.entry,
      pin: item.packageName + "@" + item.version,
    });
  }
  const deployment = (name: string, role: WorkflowRole) => {
    const receipt = published.find((item) => item.pin.startsWith(name + "@"));
    if (!receipt) throw new Error("required_workflow_package_missing");
    return {
      source: {
        kind: "asset" as const,
        assetId: receipt.assetId,
        package: { format: "tarball" as const },
      },
      entry: receipt.entry,
      pin: receipt.pin,
      sourceOfferingIds: [offeringFor(role)],
      defaultSourceOfferingId: offeringFor(role),
    };
  };
  const descriptor = InstalledWorkflows.assert({
    schemaVersion: 1,
    coordinator: deployment(
      "@corbits-builder/coordinator-native",
      "coordinator",
    ),
    writer: deployment("@corbits-builder/writer-native", "writer"),
    reviewer: deployment("@corbits-builder/reviewer-native", "reviewer"),
    coder: deployment("@corbits-builder/coder-native", "coder"),
    coderAnyPackage: deployment(
      "@corbits-builder/coder-any-package-native",
      "coder",
    ),
    designer: deployment("@corbits-builder/designer-native", "designer"),
    presenter: deployment("@corbits-builder/presenter-native", "presenter"),
  });
  await ports.db.transaction(async (tx) => {
    const [current] = await tx
      .select({ config: tenant.config })
      .from(tenant)
      .where(eq(tenant.id, actor.tenantId))
      .for("update");
    if (!current) throw startFailed();
    const stored = installedFrom(current.config);
    if (
      stored &&
      (await isCurrent(ports.db, actor.tenantId, stored, built, bindings))
    )
      return;
    const config =
      current.config &&
      typeof current.config === "object" &&
      !Array.isArray(current.config)
        ? current.config
        : {};
    await tx
      .update(tenant)
      .set({
        config: { ...config, [INSTALLED_WORKFLOWS_KEY]: descriptor },
        updatedAt: new Date(),
      })
      .where(eq(tenant.id, actor.tenantId));
  });
  return descriptor;
}

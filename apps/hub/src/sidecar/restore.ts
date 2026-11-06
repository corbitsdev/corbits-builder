import { schema, type DB } from "@intx/db";
import {
  adapterManifestDigest,
  createSidecarCredentialResolver,
} from "@intx/hub-sessions";
import type { AdapterManifest } from "@intx/types";
import { and, eq, isNull } from "drizzle-orm";
import type { LocalProcessSidecarProvisioner } from "./local-provisioner.ts";
import type { LocalSidecarHold } from "./manifest-store.ts";

export async function restoreLocalSidecars(
  db: DB["db"],
  local: LocalProcessSidecarProvisioner,
  adapterManifest: AdapterManifest,
): Promise<void> {
  const credentials = createSidecarCredentialResolver({ db });
  const currentDigest = adapterManifestDigest(adapterManifest);
  // Interchange places work only on a sidecar minted with the hub's current adapter manifest.
  async function reusable(sidecarId: string): Promise<boolean> {
    const row = await db.query.sidecar.findFirst({
      columns: { adapterManifestDigest: true },
      where: eq(schema.sidecar.id, sidecarId),
    });
    return row?.adapterManifestDigest === (await currentDigest);
  }
  async function isLive(
    hold: LocalSidecarHold & { readonly sidecarId: string },
  ): Promise<boolean> {
    const row = await db.query.sidecarAllocation.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.sidecarAllocation.id, hold.allocationId),
        eq(schema.sidecarAllocation.provisionerId, local.provisioner.id),
        eq(schema.sidecarAllocation.status, "allocated"),
        eq(schema.sidecarAllocation.generation, hold.generation),
        eq(schema.sidecarAllocation.sidecarId, hold.sidecarId),
        isNull(schema.sidecarAllocation.initializationLeaseId),
      ),
    });
    return row !== undefined;
  }
  async function hasWork(sidecarId: string): Promise<boolean> {
    return (await credentials.resolveBindings(sidecarId)).length > 0;
  }
  await local.restore({ isLive, hasWork, reusable });
}

import { and, eq } from "drizzle-orm";
import { listVisibleProviders, type DB } from "@intx/db";
import { principal, tenant } from "@intx/db/schema";
import type { ModelChoice } from "@corbits-builder/schemas/models";
import type { AvailabilityState } from "../availability.ts";
import {
  MODEL_CHOICE_REFUSALS,
  frozenModelChoice,
  pickedModelChoice,
  providerOfRow,
  resolveModelChoice,
  type ModelDirectory,
} from "../config/models.ts";
import { settingsRecord } from "../db/schema.ts";
import {
  loadSettings,
  loadSettingsAt,
  personalScopeKey,
} from "../settings/policy.ts";
import { userPrincipalIn } from "./authorization.ts";
import { ProjectError } from "./errors.ts";
import type { Actor } from "../lib/actor.ts";

/** The provider entries a tenant can run on: each enabled connection with a non-refused credential. */
export async function connectedProviders(
  db: DB["db"],
  directory: ModelDirectory,
  tenantId: string,
  probe?: (tenantId: string, providerId: string) => Promise<AvailabilityState>,
): Promise<string[]> {
  const visible = (await listVisibleProviders(db, tenantId)).filter(
    ({ row }) => row.credentialId !== null && !row.disabled,
  );
  const ids: string[] = [];
  for (const { row } of visible) {
    const entry = providerOfRow(directory, row);
    if (!entry) continue;
    if (
      probe &&
      entry.kind !== "custom" &&
      (await probe(tenantId, row.id)) === "refused"
    )
      continue;
    ids.push(entry.id);
  }
  return [...new Set(ids)];
}

// The person's own choice lives in their workspace, the project tenant's parent, under their
// principal there.
async function personalChoice(
  db: DB["db"],
  actor: Actor,
): Promise<ModelChoice | null> {
  const [row] = await db
    .select({ parentId: tenant.parentId, userId: principal.refId })
    .from(principal)
    .innerJoin(tenant, eq(tenant.id, principal.tenantId))
    .where(
      and(eq(principal.id, actor.principalId), eq(principal.kind, "user")),
    );
  if (!row?.parentId) return null;
  const member = await userPrincipalIn(db, row.parentId, row.userId);
  if (!member) return null;
  return (await loadSettingsAt(db, row.parentId, personalScopeKey(member.id)))
    .models.value;
}

/**
 * The choice a project's roles run on. A project keeps the profile it started with; one that has
 * none this server can run on a connected provider takes the caller's choice or the only connected
 * provider's profile, and keeps that from then on.
 */
export async function projectModelChoice(
  db: DB["db"],
  actor: Actor,
  projectId: string,
  directory: ModelDirectory,
  probe?: (tenantId: string, providerId: string) => Promise<AvailabilityState>,
): Promise<ModelChoice> {
  const { models } = await loadSettings(db, actor.tenantId, projectId);
  const connected = await connectedProviders(
    db,
    directory,
    actor.tenantId,
    probe,
  );
  const kept = frozenModelChoice(directory, models.value, connected);
  if (kept) return kept;
  const resolved = resolveModelChoice(
    directory,
    await personalChoice(db, actor),
    connected,
  );
  if ("refused" in resolved)
    throw new ProjectError(409, resolved.refused, {
      message: MODEL_CHOICE_REFUSALS[resolved.refused],
    });
  const scopeKey = `project:${projectId}`;
  const fields = await loadSettingsAt(db, actor.tenantId, scopeKey);
  await db
    .update(settingsRecord)
    .set({
      fields: {
        ...fields,
        models: { value: resolved.choice, version: fields.models.version + 1 },
      },
    })
    .where(
      and(
        eq(settingsRecord.tenantId, actor.tenantId),
        eq(settingsRecord.scopeKey, scopeKey),
      ),
    );
  return resolved.choice;
}

/** Switches a project onto one of the caller's runnable profiles. */
export async function switchProjectModelChoice(
  db: DB["db"],
  actor: Actor,
  projectId: string,
  profile: string,
  directory: ModelDirectory,
  probe?: (tenantId: string, providerId: string) => Promise<AvailabilityState>,
): Promise<ModelChoice> {
  const { models } = await loadSettings(db, actor.tenantId, projectId);
  const personal = await personalChoice(db, actor);
  const picked =
    pickedModelChoice(personal, profile) ??
    pickedModelChoice(models.value, profile);
  if (!picked)
    throw new ProjectError(400, "model_profile_unknown", { profile });
  const connected = await connectedProviders(
    db,
    directory,
    actor.tenantId,
    probe,
  );
  const frozen = frozenModelChoice(directory, picked, connected);
  if (!frozen)
    throw new ProjectError(409, "model_provider_missing", {
      message: MODEL_CHOICE_REFUSALS.model_provider_missing,
    });
  const scopeKey = `project:${projectId}`;
  const fields = await loadSettingsAt(db, actor.tenantId, scopeKey);
  await db
    .update(settingsRecord)
    .set({
      fields: {
        ...fields,
        models: { value: frozen, version: fields.models.version + 1 },
      },
    })
    .where(
      and(
        eq(settingsRecord.tenantId, actor.tenantId),
        eq(settingsRecord.scopeKey, scopeKey),
      ),
    );
  return frozen;
}

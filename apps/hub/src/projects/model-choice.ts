import { and, eq } from "drizzle-orm";
import { listVisibleProviders, type DB } from "@intx/db";
import { principal, tenant } from "@intx/db/schema";
import type { ModelChoice } from "@corbits-builder/schemas/models";
import {
  MODEL_CHOICE_REFUSALS,
  frozenModelChoice,
  providerOfRow,
  resolveModelChoice,
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

/** The provider entries a tenant can run on: each enabled connection with a credential. */
export async function connectedProviders(
  db: DB["db"],
  tenantId: string,
): Promise<string[]> {
  const ids = (await listVisibleProviders(db, tenantId))
    .filter(({ row }) => row.credentialId !== null && !row.disabled)
    .map(({ row }) => providerOfRow(row)?.id)
    .filter((id) => id !== undefined);
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

// A choice runs only when every tier's provider is connected in this workspace, not merely offered.
function frozenOn(
  choice: ModelChoice | null,
  connected: readonly string[],
): ModelChoice | null {
  const kept = frozenModelChoice(choice);
  const profile = kept?.custom?.find((entry) => entry.id === kept.profile);
  return profile &&
    Object.values(profile.tiers).every((binding) =>
      connected.includes(binding.provider),
    )
    ? kept
    : null;
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
): Promise<ModelChoice> {
  const { models } = await loadSettings(db, actor.tenantId, projectId);
  const connected = await connectedProviders(db, actor.tenantId);
  const kept = frozenOn(models.value, connected);
  if (kept) return kept;
  const resolved = resolveModelChoice(
    frozenOn(await personalChoice(db, actor), connected),
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

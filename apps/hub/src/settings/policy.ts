import { and, eq } from "drizzle-orm";
import type { DBExecutor } from "@intx/db";
import { settingsRecord } from "../db/schema.ts";
import { ProjectError } from "../projects/errors.ts";
import {
  type ProviderNames,
  type PreferencesField,
  type ModelsField,
  SettingsFields,
  type SettingsSave,
  type SettingsConflict,
} from "@corbits-builder/schemas/settings";

type ResolvedSettings = SettingsFields & {
  preferences: typeof PreferencesField.infer;
  models: typeof ModelsField.infer;
};

export const defaultSettings = (): ResolvedSettings => ({
  providerNames: { value: null, version: 0 },
  title: { value: null, version: 0 },
  preferences: { value: null, version: 0 },
  models: { value: null, version: 0 },
});
export const personalScopeKey = (principalId: string) =>
  `principal:${principalId}`;
export const settingsScopeKey = (projectId?: string) =>
  projectId ? `project:${projectId}` : "tenant";
export function validateProviderOverride(
  override: ProviderNames,
  tenant: ProviderNames,
) {
  return override !== null &&
    tenant !== null &&
    override.some((name) => !tenant.includes(name))
    ? "provider_override_exceeds_tenant_policy"
    : undefined;
}
export function reduceSettings(current: SettingsFields, save: SettingsSave) {
  const resolved: ResolvedSettings = { ...defaultSettings(), ...current };
  const fields = structuredClone(resolved);
  const savedFields: (keyof ResolvedSettings)[] = [];
  const conflicts: SettingsConflict[] = [];
  for (const field of [
    "providerNames",
    "title",
    "preferences",
    "models",
  ] as const) {
    const change = save.fields[field];
    if (!change) continue;
    if (change.baseVersion !== resolved[field].version) {
      conflicts.push({
        field,
        baseVersion: change.baseVersion,
        currentVersion: resolved[field].version,
        requestedValue: change.value,
        currentValue: resolved[field].value,
      });
      continue;
    }
    if (JSON.stringify(change.value) === JSON.stringify(resolved[field].value))
      continue;
    if (resolved[field].version >= Number.MAX_SAFE_INTEGER)
      throw new ProjectError(409, "settings_version_limit");
    Object.assign(fields, {
      [field]: { value: change.value, version: resolved[field].version + 1 },
    });
    savedFields.push(field);
  }
  return { fields, savedFields, conflicts };
}

// Caller holds the project lock. This policy constrains new owner admission;
// it never rewrites a native run's already approved model bindings.
export async function assertProjectProviderAllowed(
  tx: DBExecutor,
  tenantId: string,
  projectId: string,
  providerName: string,
) {
  const rows = await tx
    .select()
    .from(settingsRecord)
    .where(eq(settingsRecord.tenantId, tenantId));
  for (const scopeKey of [settingsScopeKey(), settingsScopeKey(projectId)]) {
    const row = rows.find((row) => row.scopeKey === scopeKey);
    const names = row
      ? SettingsFields.assert(row.fields).providerNames.value
      : null;
    if (names && !names.includes(providerName))
      throw new ProjectError(409, "provider_refused_by_settings");
  }
}
export async function loadSettingsAt(
  tx: DBExecutor,
  tenantId: string,
  scopeKey: string,
): Promise<ResolvedSettings> {
  const [row] = await tx
    .select()
    .from(settingsRecord)
    .where(
      and(
        eq(settingsRecord.tenantId, tenantId),
        eq(settingsRecord.scopeKey, scopeKey),
      ),
    );
  if (!row) return defaultSettings();
  return {
    ...defaultSettings(),
    ...SettingsFields.assert(structuredClone(row.fields)),
  };
}
export function loadSettings(
  tx: DBExecutor,
  tenantId: string,
  projectId?: string,
) {
  return loadSettingsAt(tx, tenantId, settingsScopeKey(projectId));
}

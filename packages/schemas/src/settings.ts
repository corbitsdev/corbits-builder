import { type } from "arktype";
import { ProjectId } from "./project.ts";
import { Preferences } from "./preferences.ts";
import { ModelChoice, StoredModelChoice } from "./models.ts";

const version = type("number.integer >= 0").atMost(Number.MAX_SAFE_INTEGER);
export const ProviderNames = type("string > 0")
  .atMostLength(200)
  .array()
  .atMostLength(100)
  .or("null");
export type ProviderNames = typeof ProviderNames.infer;
export const PreferencesField = type({
  "+": "reject",
  value: Preferences.or("null"),
  version,
});
export const ModelsField = type({
  "+": "reject",
  value: StoredModelChoice.or("null"),
  version,
});
export const SettingsFields = type({
  "+": "reject",
  providerNames: { "+": "reject", value: ProviderNames, version },
  title: { "+": "reject", value: "string | null", version },
  "preferences?": PreferencesField,
  "models?": ModelsField,
});
export type SettingsFields = typeof SettingsFields.infer;
export const SettingsSave = type({
  "+": "reject",
  command: "'save_settings'",
  idempotencyKey: ProjectId,
  fields: type({
    "+": "reject",
    "providerNames?": {
      "+": "reject",
      value: ProviderNames,
      baseVersion: version,
    },
    "title?": {
      "+": "reject",
      value: type("string > 0").atMostLength(2000),
      baseVersion: version,
    },
    "preferences?": { "+": "reject", value: Preferences, baseVersion: version },
    "models?": { "+": "reject", value: ModelChoice, baseVersion: version },
  }),
});
export type SettingsSave = typeof SettingsSave.infer;
export const ProviderAvailability = type.or(
  { "+": "reject", state: "'configured'" },
  {
    "+": "reject",
    state: "'unconfigured'",
    requiredOperatorSetup: "string > 0",
  },
  { "+": "reject", state: "'unavailable'", detail: "string > 0" },
  { "+": "reject", state: "'unsupported'" },
);
export type ProviderAvailability = typeof ProviderAvailability.infer;
export const SettingsRecord = type({
  "+": "reject",
  scope: "'tenant' | 'project' | 'personal'",
  "projectId?": ProjectId,
  fields: SettingsFields,
});
export type SettingsRecord = typeof SettingsRecord.infer;
const SettingsFieldName = type(
  "'providerNames' | 'title' | 'preferences' | 'models'",
);
const settingValue = ProviderNames.or("string").or(Preferences).or(ModelChoice);
export const SettingsConflict = type({
  "+": "reject",
  field: SettingsFieldName,
  baseVersion: version,
  currentVersion: version,
  requestedValue: settingValue,
  currentValue: settingValue,
});
export type SettingsConflict = typeof SettingsConflict.infer;
export const SettingsReceipt = type({
  "+": "reject",
  record: SettingsRecord,
  savedFields: SettingsFieldName.array(),
  conflicts: SettingsConflict.array(),
});
export type SettingsReceipt = typeof SettingsReceipt.infer;
export const SettingsProviders = type({
  "+": "reject",
  providers: type({
    "+": "reject",
    id: "string > 0",
    name: "string > 0",
    availability: ProviderAvailability,
    secrets: { "+": "reject", credential: { "+": "reject", set: "boolean" } },
  }).array(),
});
export type SettingsProviders = typeof SettingsProviders.infer;

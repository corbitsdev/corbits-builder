import { tenantPath, type ClientDeps, type ProductApiClient } from "./shared";

function settingsPath(tenantId: string, projectId?: string) {
  return `${tenantPath(tenantId)}/settings/${projectId ? `projects/${encodeURIComponent(projectId)}` : "tenant"}`;
}

function personalSettingsPath(tenantId: string) {
  return `${tenantPath(tenantId)}/settings/me`;
}

export function buildSettingsMethods(
  deps: ClientDeps,
): Pick<
  ProductApiClient,
  | "settings"
  | "saveSettings"
  | "preferenceRegistry"
  | "modelCatalog"
  | "testProvider"
  | "personalSettings"
  | "savePersonalSettings"
> {
  const { request } = deps;
  return {
    settings(tenantId, projectId, signal) {
      return request(settingsPath(tenantId, projectId), signal);
    },
    saveSettings(tenantId, projectId, input, signal) {
      return request(
        `${settingsPath(tenantId, projectId)}/save`,
        signal,
        input,
      );
    },
    preferenceRegistry(tenantId, signal) {
      return request(`${tenantPath(tenantId)}/settings/preferences`, signal);
    },
    modelCatalog(tenantId, signal) {
      return request(`${tenantPath(tenantId)}/settings/models`, signal);
    },
    testProvider(tenantId, input, signal) {
      return request(
        `${tenantPath(tenantId)}/settings/providers/test`,
        signal,
        input,
      );
    },
    personalSettings(tenantId, signal) {
      return request(personalSettingsPath(tenantId), signal);
    },
    savePersonalSettings(tenantId, input, signal) {
      return request(`${personalSettingsPath(tenantId)}/save`, signal, input);
    },
  };
}
